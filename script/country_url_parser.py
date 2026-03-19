import json
import re
from hashlib import md5
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

import requests
from bs4 import BeautifulSoup


def slugify(name: str) -> str:
    name = name.lower().strip()
    name = name.replace("&", " and ")
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return re.sub(r"_+", "_", name).strip("_")


def sanitize_tag(tag: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", tag.strip())
    if not cleaned:
        cleaned = "item"
    if cleaned[0].isdigit():
        cleaned = f"n_{cleaned}"
    return cleaned


def dict_to_xml(parent: Element, key: str, value: Any) -> None:
    tag = sanitize_tag(key)
    if isinstance(value, dict):
        node = SubElement(parent, tag)
        for child_key, child_value in value.items():
            dict_to_xml(node, str(child_key), child_value)
    elif isinstance(value, list):
        list_node = SubElement(parent, tag)
        for item in value:
            dict_to_xml(list_node, "item", item)
    else:
        node = SubElement(parent, tag)
        node.text = "" if value is None else str(value)


def country_dict_to_xml(data: dict[str, Any]) -> bytes:
    root = Element("country")
    for key, value in data.items():
        dict_to_xml(root, str(key), value)
    raw_xml = tostring(root, encoding="utf-8")
    return minidom.parseString(raw_xml).toprettyxml(indent="  ", encoding="utf-8")


class CountryInfoboxExtractor:
    def __init__(self) -> None:
        self.list_url = "https://en.wikipedia.org/wiki/List_of_sovereign_states"
        self.base_url = "https://en.wikipedia.org"
        self.project_root = Path(__file__).resolve().parent.parent
        self.output_dir = self.project_root / "Data" / "Wiki Infobox"
        self.json_dir = self.output_dir / "JSON"
        self.xml_dir = self.output_dir / "XML"
        self.html_cache_dir = self.project_root / "data-collection" / "HTML_BENCH"
        self.data: list[dict[str, Any]] = []

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "wiki-infobox-similarity-clustering/1.0 (academic project)",
            }
        )

        # Sections to exclude entirely from the extracted infobox
        self.excluded_sections: set[str] = {
            "Establishment", "History", "Time", "Codes",
        }

        # Fields to exclude from the General section
        self.excluded_general_fields: set[str] = {
            "capital", "demonym", "largest city", "federal city",
        }

        # In the Government section, only keep the government type field itself
        self.government_only_field: str = "government"

        self.section_rules: list[tuple[str, tuple[str, ...]]] = [
            (
                "General",
                (
                    "official language",
                    "recognized",
                    "recognised",
                    "ethnic",
                    "religion",
                    "motto",
                    "anthem",
                ),
            ),
            (
                "Government",
                (
                    "government",
                    "president",
                    "prime minister",
                    "chief justice",
                    "legislature",
                    "upper house",
                    "lower house",
                    "speaker",
                    "leader",
                    "king",
                    "emir",
                ),
            ),
            ("Area", ("area", "water")),
            ("Population", ("population", "density", "census", "estimate")),
            (
                "Economy",
                (
                    "gdp",
                    "gni",
                    "hdi",
                    "gini",
                    "per capita",
                    "currency",
                    "ppp",
                    "nominal",
                    "inflation",
                    "debt",
                    "revenue",
                    "expenditure",
                ),
            ),
        ]

    @staticmethod
    def clean_text(value: str) -> str:
        return " ".join(value.replace("\xa0", " ").split())

    @staticmethod
    def remove_references(text: str) -> str:
        text = re.sub(r"\[[^\]]*\]", "", text)
        text = re.sub(r"\(listen\)", "", text)
        text = re.sub(r"\u200b", "", text)
        return text

    def clean_value_text(self, text: str) -> str:
        cleaned = self.clean_text(self.remove_references(text))
        cleaned = re.sub(r"\s*\([\s,;]*\)", "", cleaned)
        cleaned = re.sub(r"(?:^[,;:\s]+|[,;:\s]+$)", "", cleaned)
        return cleaned.strip()

    @staticmethod
    def format_percentage(value: float) -> str:
        rendered = f"{value:.2f}".rstrip("0").rstrip(".")
        return f"{rendered}%"

    def cache_path_for_url(self, url: str) -> Path:
        digest = md5(url.encode("utf-8")).hexdigest()
        return self.html_cache_dir / f"{digest}.html"

    def save_html_cache(self, url: str, html: str) -> None:
        self.html_cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_path_for_url(url).write_text(html, encoding="utf-8")

    def load_html_cache(self, url: str) -> Optional[str]:
        cache_path = self.cache_path_for_url(url)
        if not cache_path.exists():
            return None
        return cache_path.read_text(encoding="utf-8")

    def get_html(self, url: str, timeout: int = 30) -> str:
        response = self.session.get(url, timeout=timeout)
        response.raise_for_status()
        return response.text

    def get_html_with_fallback(self, url: str, timeout: int = 30) -> str:
        try:
            html = self.get_html(url, timeout=timeout)
            self.save_html_cache(url, html)
            return html
        except requests.exceptions.RequestException:
            cached_html = self.load_html_cache(url)
            if cached_html is None:
                raise
            return cached_html

    def parse_country_links(self, html: str) -> list[tuple[str, str]]:
        soup = BeautifulSoup(html, "html.parser")
        table = soup.select_one("table.wikitable tbody")
        if table is None:
            return []

        country_links: list[tuple[str, str]] = []
        for row in table.select("tr"):
            cells = row.find_all("td")
            if not cells:
                continue

            first_cell = cells[0]
            anchor = first_cell.select_one("b a[href^='/wiki/']") or first_cell.select_one("a[href^='/wiki/']")
            if anchor is None:
                continue

            country_name = anchor.get_text(" ", strip=True)
            href = anchor.get("href")
            if not country_name or not href or ":" in href:
                continue

            country_links.append((country_name, urljoin(self.base_url, href)))

        unique_links: dict[str, str] = {}
        for name, link in country_links:
            if name not in unique_links:
                unique_links[name] = link

        return list(unique_links.items())

    def build_test_bench(self, country_links: list[tuple[str, str]]) -> None:
        self.html_cache_dir.mkdir(parents=True, exist_ok=True)
        for _, country_url in country_links:
            if self.cache_path_for_url(country_url).exists():
                continue
            try:
                html = self.get_html(country_url)
                self.save_html_cache(country_url, html)
            except requests.exceptions.RequestException:
                continue

    @staticmethod
    def normalize_section_name(name: str) -> str:
        aliases = {
            "formation": "History",
            "establishment history": "History",
            "history": "History",
            "area": "Area",
            "population": "Population",
            "general": "General",
            "government": "Government",
            "economy": "Economy",
            "time": "Time",
            "codes": "Codes",
        }
        return aliases.get(name.strip().lower(), name.strip())

    # Only these fields are kept in the General section
    _allowed_general_fields: tuple[str, ...] = (
        "official language",
        "ethnic group",
        "religion",
    )

    def is_excluded_field(self, key: str, section: str) -> bool:
        """Check if a field should be excluded based on section and key."""
        if section == "General":
            key_lower = key.lower()
            # Only keep Official languages, Ethnic groups, and Religion
            if not any(allowed in key_lower for allowed in self._allowed_general_fields):
                return True
        if section == "Government":
            # Only keep the government type field, exclude all others
            if key.lower() != self.government_only_field:
                return True
        if section == "Population":
            if "date format" in key.lower():
                return True
        return False

    # Keywords for fields that belong to excluded sections — used to skip them
    _excluded_field_keywords: tuple[str, ...] = (
        "time zone", "dst", "utc", "calendar",
        "iso", "internet tld", "calling code", "driving side", "cctld",
        "formation", "independence", "constitution", "established",
        "founded", "annexed", "unification",
    )

    def infer_section_for_key(self, key: str, fallback_section: str) -> str:
        key_lower = key.lower()
        # Check if the field belongs to an excluded section by keyword
        if any(kw in key_lower for kw in self._excluded_field_keywords):
            # Route to the matching excluded section name so it gets filtered
            if any(kw in key_lower for kw in ("time zone", "dst", "utc", "calendar")):
                return "Time"
            if any(kw in key_lower for kw in ("iso", "internet tld", "calling code", "driving side", "cctld")):
                return "Codes"
            return "History"
        for section, keywords in self.section_rules:
            if any(keyword in key_lower for keyword in keywords):
                return section
        return fallback_section

    @staticmethod
    def can_be_subbranch_parent(key: str) -> bool:
        key_lower = key.lower()
        return any(marker in key_lower for marker in ("gdp", "gni", "inflation", "debt", "revenue", "expenditure"))

    @staticmethod
    def append_list_value(container: dict[str, Any], key: str, value: str) -> None:
        current = container.get(key)
        if current is None:
            container[key] = [value]
            return

        if isinstance(current, list):
            current.append(value)
            return

        container[key] = [str(current), value]

    def parse_infobox(self, html: str) -> dict[str, dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        infobox = soup.select_one("table.infobox")
        if infobox is None:
            return {}

        parsed: dict[str, dict[str, Any]] = {"General": {}}
        current_section = "General"
        current_parent_by_section: dict[str, Optional[str]] = {"General": None}
        active_parent_section: Optional[str] = None
        active_parent_key: Optional[str] = None

        def ensure_section(section_name: str) -> None:
            if section_name not in parsed:
                parsed[section_name] = {}
            if section_name not in current_parent_by_section:
                current_parent_by_section[section_name] = None

        for row in infobox.select("tr"):
            section_cell = row.find("th", class_="infobox-header")
            if section_cell:
                section_name = self.clean_value_text(section_cell.get_text(" ", strip=True))
                if not section_name:
                    section_name = "General"
                current_section = self.normalize_section_name(section_name)
                if current_section in self.excluded_sections:
                    continue
                ensure_section(current_section)
                current_parent_by_section[current_section] = None
                active_parent_section = None
                active_parent_key = None
                continue

            label_cell = row.find("th", class_="infobox-label")
            data_cell = row.find("td", class_="infobox-data")

            if label_cell and data_cell:
                raw_key = self.clean_value_text(label_cell.get_text(" ", strip=True))
                if not raw_key:
                    continue

                is_bullet = raw_key.startswith("•")
                key = raw_key.lstrip("•").strip()
                value = self.clean_value_text(data_cell.get_text(" ", strip=True))
                if not key or not value:
                    continue

                if is_bullet and active_parent_section and active_parent_key:
                    target_section = active_parent_section
                    parent_key = active_parent_key
                else:
                    target_section = self.infer_section_for_key(key, current_section)
                    parent_key = current_parent_by_section.get(target_section)

                # Skip excluded sections and fields
                if target_section in self.excluded_sections:
                    continue
                if self.is_excluded_field(key, target_section):
                    continue

                ensure_section(target_section)
                section_payload = parsed[target_section]

                if is_bullet and parent_key:
                    parent_payload = section_payload.get(parent_key)
                    if not isinstance(parent_payload, dict):
                        details: dict[str, Any] = {}
                        if isinstance(parent_payload, list) and parent_payload:
                            details["Details"] = parent_payload
                        section_payload[parent_key] = details
                        parent_payload = section_payload[parent_key]

                    self.append_list_value(parent_payload, key, value)
                else:
                    self.append_list_value(section_payload, key, value)
                    if self.can_be_subbranch_parent(key):
                        current_parent_by_section[target_section] = key
                        active_parent_section = target_section
                        active_parent_key = key
                    else:
                        current_parent_by_section[target_section] = None
                        if active_parent_section == target_section:
                            active_parent_section = None
                            active_parent_key = None

                continue

            if data_cell and not label_cell:
                value = self.clean_value_text(data_cell.get_text(" ", strip=True))
                if value:
                    if active_parent_section and active_parent_key:
                        target_section = active_parent_section
                        parent_key = active_parent_key
                    else:
                        target_section = current_section
                        parent_key = current_parent_by_section.get(current_section)

                    ensure_section(target_section)
                    section_payload = parsed[target_section]
                    if parent_key and isinstance(section_payload.get(parent_key), dict):
                        self.append_list_value(section_payload[parent_key], "Details", value)
                    else:
                        self.append_list_value(section_payload, "Details", value)

        if "General" in parsed and not parsed["General"]:
            del parsed["General"]

        # Fallback: fill missing Religion / Ethnic groups from article body
        general = parsed.get("General", {})
        has_religion = "Religion" in general and not (
            isinstance(general.get("Religion"), str)
            and "see" in general.get("Religion", "").lower()
        )
        has_ethnic = any("ethnic" in k.lower() for k in general)

        if not has_religion or not has_ethnic:
            if "General" not in parsed:
                parsed["General"] = {}
            body_data = self._parse_demographics_from_body(soup)
            if not has_religion and body_data.get("Religion"):
                parsed["General"]["Religion"] = body_data["Religion"]
            if not has_ethnic and body_data.get("Ethnic groups"):
                parsed["General"]["Ethnic groups"] = body_data["Ethnic groups"]
            # Remove "See X" placeholder if we got real data
            if has_religion is False and isinstance(general.get("Religion"), str):
                if body_data.get("Religion"):
                    parsed["General"]["Religion"] = body_data["Religion"]

        if "General" in parsed and not parsed["General"]:
            del parsed["General"]

        return parsed

    def _extract_section_text(self, soup: BeautifulSoup, section_id: str) -> str:
        """Extract all paragraph text from an article body section until the next heading."""
        heading = soup.find(id=section_id)
        if heading is None:
            return ""

        # Go to the parent div wrapper (mw-heading) then iterate siblings
        parent = heading.parent
        if parent and "mw-heading" in " ".join(parent.get("class", [])):
            start = parent
        else:
            start = heading

        texts: list[str] = []
        for sibling in start.next_siblings:
            if sibling.name and re.match(r"h[1-4]", sibling.name):
                break
            if sibling.name and "mw-heading" in " ".join(sibling.get("class", [])):
                break
            if sibling.name in ("p", "ul", "ol", "div"):
                texts.append(self.clean_text(self.remove_references(sibling.get_text(" ", strip=True))))

        return " ".join(texts)

    def _parse_percentages_from_text(self, text: str) -> dict[str, float]:
        """Extract label-percentage pairs from article body text.

        Handles formats like:
            '49.7% Christianity', 'Islam 8.3%',
            'Roman Catholics representing 29.9 percent',
            'identified as Protestant at 23.1%'
        """
        results: dict[str, float] = {}
        if not text:
            return results

        # Normalize "percent" to "%"
        text = re.sub(r"(\d)\s+percent\b", r"\1%", text, flags=re.IGNORECASE)

        # Pattern 1: "X% Label" — e.g., "49.7% Christianity"
        for m in re.finditer(
            r"(\d+(?:\.\d+)?)\s*%\s+(?:are\s+|identified\s+as\s+|of\s+the\s+population\s+)?([A-Z][a-zA-Zé\- ]{1,40})",
            text,
        ):
            pct, label = float(m.group(1)), m.group(2).strip().rstrip(" .,;and")
            if label and 0 < pct <= 100:
                results[label] = pct

        # Pattern 2: "Label X%" or "Label at X%" or "Label (X%)"
        for m in re.finditer(
            r"([A-Z][a-zA-Zé\- ]{1,40?})\s+(?:at\s+|represent(?:ing|s)?\s+|with\s+|comprising\s+)?(\d+(?:\.\d+)?)\s*%",
            text,
        ):
            label, pct = m.group(1).strip().rstrip(" .,;and"), float(m.group(2))
            if label and 0 < pct <= 100:
                if label not in results:
                    results[label] = pct

        return results

    def _parse_demographics_from_body(self, soup: BeautifulSoup) -> dict[str, Any]:
        """Parse Religion and Ethnic group data from the article body as fallback."""
        result: dict[str, Any] = {}

        # Try multiple possible section IDs for religion
        for section_id in ("Religion", "Religion_2", "Religions"):
            religion_text = self._extract_section_text(soup, section_id)
            if religion_text:
                break

        if religion_text:
            pcts = self._parse_percentages_from_text(religion_text)
            if pcts:
                # Use parse_percentage_items + build_percentage_tree for consistency
                items = [(v, k) for k, v in sorted(pcts.items(), key=lambda x: -x[1])]
                if len(items) >= 2:
                    result["Religion"] = self.build_percentage_tree(items)

        # Try multiple possible section IDs for ethnic groups
        for section_id in ("Ethnic_groups", "Ethnicity", "Demographics", "Ethnic_groups_2"):
            ethnic_text = self._extract_section_text(soup, section_id)
            if ethnic_text:
                break

        if ethnic_text:
            pcts = self._parse_percentages_from_text(ethnic_text)
            if pcts:
                items = [(v, k) for k, v in sorted(pcts.items(), key=lambda x: -x[1])]
                if len(items) >= 2:
                    result["Ethnic groups"] = {
                        label: self.format_percentage(percent)
                        for percent, label in items
                    }

        return result

    def parse_percentage_items(self, text: str) -> list[tuple[float, str]]:
        pattern = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*([^%]+?)(?=(?:\d+(?:\.\d+)?)\s*%|$)")
        matches = pattern.findall(text)

        parsed: list[tuple[float, str]] = []
        for percent, label in matches:
            cleaned_label = self.clean_value_text(label)
            if not cleaned_label:
                continue
            try:
                parsed.append((float(percent), cleaned_label))
            except ValueError:
                continue
        return parsed

    def build_percentage_tree(self, items: list[tuple[float, str]], tolerance: float = 0.3) -> dict[str, Any]:
        def parse_slice(start: int, end: int) -> tuple[dict[str, Any], int]:
            result: dict[str, Any] = {}
            index = start

            while index < end:
                percent, label = items[index]
                node: dict[str, Any] = {"percentage": self.format_percentage(percent)}

                child_start = index + 1
                child_end = child_start
                cumulative = 0.0

                while child_end < end:
                    child_percent, _ = items[child_end]
                    if child_percent > percent + tolerance:
                        break
                    if child_percent >= percent:
                        break

                    cumulative += child_percent
                    child_end += 1

                    if abs(cumulative - percent) <= tolerance:
                        break
                    if cumulative > percent + tolerance:
                        child_end -= 1
                        break

                if child_end > child_start:
                    child_total = sum(value for value, _ in items[child_start:child_end])
                    if abs(child_total - percent) <= tolerance:
                        children, _ = parse_slice(child_start, child_end)
                        if children:
                            node["breakdown"] = children
                        index = child_end
                    else:
                        index += 1
                else:
                    index += 1

                if len(node) == 1:
                    result[label] = node["percentage"]
                else:
                    result[label] = node

            return result, index

        tree, _ = parse_slice(0, len(items))
        return tree

    def normalize_value(self, field_key: str, raw_value: Any) -> Any:
        if isinstance(raw_value, dict):
            return {
                self.clean_value_text(k): self.normalize_value(k, v)
                for k, v in raw_value.items()
                if self.clean_value_text(k) and self.clean_value_text(k) != "Details"
            }

        if isinstance(raw_value, list):
            normalized_items = [self.normalize_value(field_key, item) for item in raw_value]
            normalized_items = [item for item in normalized_items if item not in ("", None, [], {})]
            if len(normalized_items) == 1:
                return normalized_items[0]
            return normalized_items

        text = self.clean_value_text(str(raw_value))
        if not text:
            return ""

        percentage_items = self.parse_percentage_items(text)
        if len(percentage_items) >= 2:
            if "religion" in field_key.lower():
                return self.build_percentage_tree(percentage_items)
            return {label: self.format_percentage(percent) for percent, label in percentage_items}

        # Remove all parenthetical content from values
        text = re.sub(r"\s*\([^)]*\)", "", text).strip()
        # Clean up any trailing/leading punctuation left over
        text = re.sub(r"(?:^[,;:\s]+|[,;:\s]+$)", "", text).strip()

        return text

    @staticmethod
    def strip_year_from_field(field: str) -> str:
        """Remove year-related parenthetical info from field names.

        Examples:
            'Ethnic groups (2024 est.)' -> 'Ethnic groups'
            'Religion (2019 census)'    -> 'Religion'
            'Gini (2021)'              -> 'Gini'
            'HDI (2023)'               -> 'HDI'
            '2024 estimate'            -> 'Estimate'
            'January 2025 estimate'    -> 'Estimate'
            'mid-2024/2025 estimate'   -> 'Estimate'
            'Nationality (2024)'       -> 'Nationality'
        """
        # Remove parenthetical containing a year: "Field (2021)" -> "Field"
        # Also handles "Field ( 2021 )", "Field (2021 census)", etc.
        cleaned = re.sub(r"\s*\([^()]*\b(?:19|20)\d{2}\b[^()]*\)", "", field)
        # Handle nested parens: "Gini (2022 (last available data))"
        # If a year-containing paren still remains (nested case), strip it
        if re.search(r"\(\s*(?:19|20)\d{2}", cleaned):
            cleaned = re.sub(r"\s*\(.*\b(?:19|20)\d{2}\b.*\)", "", field)

        # Handle fields that START with a year/date: "2024 estimate" -> "Estimate"
        # Matches: "2024 estimate", "January 2025 estimate", "mid-2024/2025 estimate",
        # "Q3 2025 estimate", "30 June 2025 estimate", etc.
        if re.match(r"^[\w\-./,\s]*\b(?:19|20)\d{2}\b[\w\-./,\s]*$", cleaned):
            # Extract the trailing descriptor (estimate, census)
            match = re.search(r"(estimate|census)\s*$", cleaned, re.IGNORECASE)
            if match:
                cleaned = match.group(1).capitalize()
            else:
                cleaned = "Estimate"

        return cleaned.strip()

    @staticmethod
    def _expand_number(raw: str) -> str:
        """Convert word-based multipliers to full numbers.

        Examples:
            "682.86 billion" -> "682860000000"
            "1.493 trillion" -> "1493000000000"
            "31,379"         -> "31379"  (just strip commas)
        """
        multipliers = {
            "trillion": 1_000_000_000_000,
            "billion": 1_000_000_000,
            "million": 1_000_000,
            "thousand": 1_000,
        }
        raw = raw.strip()
        for word, factor in multipliers.items():
            m = re.match(
                rf"^([\d,.\-–]+)\s*{word}$", raw, re.IGNORECASE
            )
            if m:
                num_str = m.group(1).replace(",", "")
                try:
                    result = float(num_str) * factor
                    # Return as integer string if it's a whole number
                    if result == int(result):
                        return str(int(result))
                    return f"{result:.0f}"
                except ValueError:
                    return raw
        # No multiplier word — just strip commas
        return raw.replace(",", "")

    @staticmethod
    def extract_unit_from_value(key: str, value: Any) -> tuple[str, Any]:
        """Extract units from numeric values and move them into the key.

        Returns (new_key, new_value).
        """
        if not isinstance(value, str):
            return key, value

        # Area fields: "83,879 km 2" -> key "(km2)", value "83879"
        m = re.match(r"^([\d,.\-–]+)\s+km\s*2\s*$", value)
        if m:
            return f"{key} (km2)", m.group(1).replace(",", "")

        # Area fields: "3,531,905 sq mi" -> key "(sq mi)", value "3531905"
        m = re.match(r"^([\d,.\-–]+)\s+sq\s+mi\s*$", value)
        if m:
            return f"{key} (sq mi)", m.group(1).replace(",", "")

        # Density: "64/km 2" -> key "(/km2)", value "64"
        m = re.match(r"^([\d,.\-–]+)\s*/\s*km\s*2\s*$", value)
        if m:
            return f"{key} (/km2)", m.group(1).replace(",", "")

        # GDP Total/Per capita: "$91.668 billion" -> key "($)", value "91668000000"
        m = re.match(r"^\$\s*([\d,.\-–]+\s*(?:trillion|billion|million)?)\s*$", value)
        if m:
            return f"{key} ($)", CountryInfoboxExtractor._expand_number(m.group(1).strip())

        # Gini: "29.4 low inequality" -> value "29.4"
        if key.lower() == "gini":
            m = re.match(r"^([\d.]+)", value)
            if m:
                return key, m.group(1)

        # HDI: "0.496 low" -> value "0.496"
        if key.lower() == "hdi":
            m = re.match(r"^([\d.]+)", value)
            if m:
                return key, m.group(1)

        # Water (%): "28%" or "1.8" — strip % if present
        if "water" in key.lower() and "%" in key.lower():
            value = value.rstrip("%").strip()
            return key, value

        # Percentage values: "55.2%" -> key "(%), value "55.2"
        # For the "percentage" key, just strip the % sign (key already implies it)
        m = re.match(r"^([\d.]+)%$", value)
        if m:
            if key.lower() == "percentage":
                return key, m.group(1)
            return f"{key} (%)", m.group(1)

        # General: pure comma-separated numbers "46,735,004" -> "46735004"
        # Also handles "682.86 billion" -> "682860000000" for non-GDP fields
        m = re.match(r"^[\d,.\-–]+\s*(?:trillion|billion|million|thousand)?$", value)
        if m:
            return key, CountryInfoboxExtractor._expand_number(value)

        return key, value

    def _extract_units_recursive(self, key: str, value: Any) -> tuple[str, Any]:
        """Apply unit extraction recursively into dicts."""
        if isinstance(value, dict):
            new_dict: dict[str, Any] = {}
            for k, v in value.items():
                new_k, new_v = self._extract_units_recursive(k, v)
                new_dict[new_k] = new_v
            return key, new_dict
        return self.extract_unit_from_value(key, value)

    @staticmethod
    def _convert_numeric(value: Any) -> Any:
        """Recursively convert string values that represent numbers to int or float."""
        if isinstance(value, dict):
            return {k: CountryInfoboxExtractor._convert_numeric(v) for k, v in value.items()}
        if isinstance(value, list):
            return [CountryInfoboxExtractor._convert_numeric(v) for v in value]
        if isinstance(value, str):
            # Only convert pure numeric strings (int or float)
            # Skip strings with ranges (–), text, or other non-numeric content
            stripped = value.strip()
            if not stripped:
                return value
            try:
                # Try integer first
                if re.fullmatch(r"-?\d+", stripped):
                    return int(stripped)
                # Try float
                if re.fullmatch(r"-?\d+\.\d+", stripped):
                    return float(stripped)
            except (ValueError, OverflowError):
                pass
        return value

    def normalize_infobox_sections(self, infobox_sections: dict[str, dict[str, Any]]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}

        for section_name, section_payload in infobox_sections.items():
            clean_section = self.clean_value_text(section_name)
            if not clean_section:
                continue
            if clean_section in self.excluded_sections:
                continue
            if "independence" in clean_section.lower() or "formation" in clean_section.lower():
                continue
            if "historical" in clean_section.lower() or "unification" in clean_section.lower():
                continue

            normalized_section: dict[str, Any] = {}
            for field_name, field_value in section_payload.items():
                clean_field = self.clean_value_text(field_name)
                if not clean_field:
                    continue

                # Strip year info from field names
                clean_field = self.strip_year_from_field(clean_field)
                if not clean_field:
                    continue

                normalized_value = self.normalize_value(clean_field, field_value)
                if normalized_value in ("", None, [], {}):
                    continue

                # Extract units from values into keys
                clean_field, normalized_value = self._extract_units_recursive(
                    clean_field, normalized_value
                )

                # First value wins for duplicate canonical names
                if clean_field not in normalized_section:
                    normalized_section[clean_field] = normalized_value

            if normalized_section:
                normalized[clean_section] = normalized_section

        # Convert all numeric strings to actual int/float values
        return self._convert_numeric(normalized)

    def fetch(self) -> None:
        try:
            list_html = self.get_html_with_fallback(self.list_url)
            country_links = self.parse_country_links(list_html)
            self.build_test_bench(country_links)

            for country_name, country_url in country_links:
                try:
                    country_html = self.get_html_with_fallback(country_url)
                    infobox_sections = self.parse_infobox(country_html)
                    structured_infobox = self.normalize_infobox_sections(infobox_sections)
                    self.data.append(
                        {
                            "country": country_name,
                            "infobox": structured_infobox,
                        }
                    )
                except (requests.exceptions.RequestException, ValueError) as country_error:
                    self.data.append(
                        {
                            "country": country_name,
                            "infobox": {},
                            "error": str(country_error),
                        }
                    )
        except (requests.exceptions.RequestException, ValueError) as error:
            print(f"Error occurred while collecting country data: {error}")
        finally:
            print("Work done!")

    def to_files(self) -> None:
        self.json_dir.mkdir(parents=True, exist_ok=True)
        self.xml_dir.mkdir(parents=True, exist_ok=True)

        for record in self.data:
            country_name = record.get("country", "unknown")
            filename = slugify(country_name)

            json_path = self.json_dir / f"{filename}.json"
            json_path.write_text(
                json.dumps(record, ensure_ascii=False, indent=4),
                encoding="utf-8",
            )

            xml_bytes = country_dict_to_xml(record)
            xml_path = self.xml_dir / f"{filename}.xml"
            xml_path.write_bytes(xml_bytes)

        all_json_path = self.json_dir / "all_countries.json"
        all_json_path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=4),
            encoding="utf-8",
        )

        print(f"Wrote {len(self.data)} country files to {self.json_dir} and {self.xml_dir}")


def main() -> None:
    extractor = CountryInfoboxExtractor()
    extractor.fetch()
    extractor.to_files()


if __name__ == "__main__":
    main()
