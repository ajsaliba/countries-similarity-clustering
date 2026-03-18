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

        self.section_rules: list[tuple[str, tuple[str, ...]]] = [
            (
                "General",
                (
                    "capital",
                    "official language",
                    "recognized",
                    "recognised",
                    "ethnic",
                    "religion",
                    "demonym",
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
            ("Time", ("time zone", "dst", "utc", "calendar")),
            ("Codes", ("iso", "internet tld", "calling code", "driving side", "cctld")),
            (
                "History",
                (
                    "formation",
                    "independence",
                    "constitution",
                    "established",
                    "founded",
                    "annexed",
                    "unification",
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

    def infer_section_for_key(self, key: str, fallback_section: str) -> str:
        key_lower = key.lower()
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

        return parsed

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
            return {self.clean_value_text(k): self.normalize_value(k, v) for k, v in raw_value.items() if self.clean_value_text(k)}

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

        return text

    def normalize_infobox_sections(self, infobox_sections: dict[str, dict[str, Any]]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}

        for section_name, section_payload in infobox_sections.items():
            clean_section = self.clean_value_text(section_name)
            if not clean_section:
                continue

            normalized_section: dict[str, Any] = {}
            for field_name, field_value in section_payload.items():
                clean_field = self.clean_value_text(field_name)
                if not clean_field:
                    continue

                normalized_value = self.normalize_value(clean_field, field_value)
                if normalized_value in ("", None, [], {}):
                    continue

                normalized_section[clean_field] = normalized_value

            if normalized_section:
                normalized[clean_section] = normalized_section

        return normalized

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
                            "url": country_url,
                            "infobox": structured_infobox,
                        }
                    )
                except (requests.exceptions.RequestException, ValueError) as country_error:
                    self.data.append(
                        {
                            "country": country_name,
                            "url": country_url,
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
