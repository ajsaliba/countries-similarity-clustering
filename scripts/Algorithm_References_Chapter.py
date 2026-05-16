from __future__ import annotations

import argparse
import bisect
import copy
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

@dataclass
class TreeNode:
    label: str
    raw_value: Optional[str] = None
    norm_value: Optional[str] = None
    norm_number: Optional[float] = None
    kind: str = "internal"
    top_section: Optional[str] = None
    numeric_field: Optional[str] = None
    patch_id: Optional[str] = None
    depth: int = 0
    children: List["TreeNode"] = field(default_factory=list)

    def is_leaf(self) -> bool:
        return len(self.children) == 0

    def clone(self) -> "TreeNode":
        return copy.deepcopy(self)

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "label": self.label,
            "kind": self.kind,
        }
        if self.raw_value is not None:
            out["raw_value"] = self.raw_value
        if self.norm_value is not None:
            out["norm_value"] = self.norm_value
        if self.norm_number is not None:
            out["norm_number"] = self.norm_number
        if self.top_section is not None:
            out["top_section"] = self.top_section
        if self.numeric_field is not None:
            out["numeric_field"] = self.numeric_field
        if self.depth:
            out["depth"] = self.depth
        if self.children:
            out["children"] = [c.to_dict() for c in self.children]
        return out

    def pretty(self, level: int = 0, show: str = "norm") -> str:
        indent = "  " * level

        if show == "raw":
            shown_value = self.raw_value
        elif show == "norm":
            shown_value = self.norm_value
        elif show == "number":
            shown_value = None if self.norm_number is None else f"{self.norm_number:.6f}"
        else:
            shown_value = self.norm_value

        line = f"{indent}{self.label}" if shown_value is None else f"{indent}{self.label}: {shown_value}"
        if not self.children:
            return line
        return line + "\n" + "\n".join(child.pretty(level + 1, show=show) for child in self.children)




DETAIL_LABELS_CLEAN = {
    "Federal city",
    "Largest city",
    "Government seat",
    "Countries (non-sovereign parts)",
}


LEGISLATURE_ROLE_HINTS = {
    "bundesrat": "Upper house",
    "bundestag": "Lower house",
    "council of states": "Upper house",
    "national council": "Lower house",
    "federal council": "Upper house",
    "senate": "Upper house",
    "house of lords": "Upper house",
    "house of commons": "Lower house",
    "house of representatives": "Lower house",
    "national assembly": "Lower house",
}


LANGUAGE_NOISE = {
    "and",
    "or",
    "de",
    "la",
    "le",
    "official",
    "regional",
    "recognized",
    "recognised",
    "minority",
    "national",
    "language",
    "languages",
    "locally",
}


RELIGION_BUCKETS = {
    "christianity": "Christianity",
    "christian": "Christianity",
    "catholic": "Christianity",
    "orthodox": "Christianity",
    "armenian apostolic": "Christianity",
    "protestant": "Christianity",
    "other christians": "Christianity",
    "islam": "Islam",
    "muslim": "Islam",
    "sunni": "Islam",
    "shia": "Islam",
    "shi'a": "Islam",
    "shia islam": "Islam",
    "alawite": "Islam",
    "no religion": "No religion",
    "irreligion": "No religion",
    "agnostic": "No religion",
    "atheist": "No religion",
    "atheism": "No religion",
    "druze": "Other",
    "jewish": "Other",
    "judaism": "Other",
    "other": "Other",
    "other religions": "Other",
}




USE_SCHEMA_NORMALIZATION = False
USE_SPACY = True
SPACY_MODEL_NAME = "en_core_web_sm"
_SPACY_NLP = None
_SPACY_DISABLED = False
_SPACY_DOC_CACHE: Dict[str, Any] = {}


def _get_spacy():
    global _SPACY_NLP, _SPACY_DISABLED
    if _SPACY_DISABLED or not USE_SPACY:
        return None
    if _SPACY_NLP is None:
        try:
            import spacy
            _SPACY_NLP = spacy.load(SPACY_MODEL_NAME, disable=["parser"])
        except Exception as exc:
            _SPACY_DISABLED = True
            print(f"[spacy] disabled, using legacy regex parsers ({exc})")
            return None
    return _SPACY_NLP


def _spacy_doc(text: str):
    cached = _SPACY_DOC_CACHE.get(text)
    if cached is not None:
        return cached
    nlp = _get_spacy()
    if nlp is None:
        return None
    doc = nlp(text)
    _SPACY_DOC_CACHE[text] = doc
    return doc


def collapse_spaces(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = text.replace("\u200b", "")
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    text = text.replace("•", ", ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def compare_text(text: Optional[str]) -> str:
    return "" if text is None else collapse_spaces(text).casefold()


def scalar_to_raw_text(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return collapse_spaces(str(value))


def split_camel_case(text: str) -> str:
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", text)


def tokenize_text(text: str) -> List[str]:
    text = collapse_spaces(text)
    text = split_camel_case(text)
    text = re.sub(r"[_/\\|]+", " ", text)
    text = re.sub(r"[-–—]+", " ", text)
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip().lower()
    if not text:
        return []
    return [tok for tok in text.split(" ") if tok]




def canonicalize_key(key: str) -> str:
    k = collapse_spaces(str(key))

    if re.fullmatch(r"GDP\s*\(\s*PPP\s*\)?", k, flags=re.I):
        return "GDP (PPP)"
    if re.fullmatch(r"GDP\s*\(\s*nominal\s*\)?", k, flags=re.I):
        return "GDP (nominal)"
    if re.fullmatch(r"Water\s*\(%\)?", k, flags=re.I):
        return "Water (%)"

    if re.fullmatch(r"Religion\s*\([^)]*\)", k, flags=re.I):
        return "Religion"
    if re.fullmatch(r"Ethnic groups\s*\([^)]*\)", k, flags=re.I):
        return "Ethnic groups"
    if re.fullmatch(r"Gini\s*\([^)]*\)", k, flags=re.I):
        return "Gini"
    if re.fullmatch(r"HDI\s*\([^)]*\)", k, flags=re.I):
        return "HDI"

    low = k.casefold()

    if low in {"demonym", "demonyms"}:
        return "Demonyms"

    if low in {
        "official language",
        "official languages",
        "official language and national language",
        "official languages and national language",
    }:
        return "Official languages"

    if low in {"recognized regional languages", "recognised regional languages"}:
        return "Official regional languages"

    if low in {"recognized national languages", "recognised national languages"}:
        return "Recognized national languages"

    if low in {"recognized minority languages", "recognised minority languages"}:
        return "Recognized minority languages"

    if low in {"national language", "national languages"}:
        return "National languages"

    if low == "capital and largest city":
        return "Capital"

    if low == "government seat":
        return "Government seat"

    if low == "federal city":
        return "Federal city"

    if low == "largest city":
        return "Largest city"

    if low in {"nationality", "ethnicity", "ethnic groups", "ethnic group", "ethnic groups / nationality"}:
        return "Ethnic Groups"

    if low in {"religion", "religions"}:
        return "Religions"

    if low in {"gdp ppp", "gdp (ppp)"}:
        return "GDP PPP"
    if low in {"gdp nominal", "gdp (nominal)"}:
        return "GDP Nominal"

    if low == "government type":
        return "Government type"
    if low == "government structure":
        return "Government structure"

    if low.startswith("countries (non"):
        return "Countries (non-sovereign parts)"

    return k


def merge_values(existing: Any, new_value: Any) -> Any:
    if isinstance(existing, list):
        if isinstance(new_value, list):
            return existing + new_value
        return existing + [new_value]
    if isinstance(new_value, list):
        return [existing] + new_value
    return [existing, new_value]


def _clean_language_label(text: str) -> str:
    t = collapse_spaces(str(text))
    t = re.sub(r"\([^)]*\)", "", t)
    t = re.sub(r"\d[\d.,]*\s*%.*$", "", t)
    t = re.sub(r"^(?:and|or)\s+", "", t, flags=re.I)
    t = t.strip(" ,;:/")
    return collapse_spaces(t)


LANGUAGE_ENT_LABELS = {"LANGUAGE", "NORP"}
LANGUAGE_BAD_TOKENS = {
    "official", "national", "regional", "minority", "recognized",
    "recognised", "language", "languages", "vernacular", "local",
    "spoken", "majority", "co", "and", "or",
}


def _split_language_items_spacy(text: str) -> Optional[List[str]]:
    doc = _spacy_doc(_clean_language_label(text) or text)
    if doc is None:
        return None

    seen: List[str] = []
    seen_low: set = set()

    def add(candidate: str) -> None:
        label = _clean_language_label(candidate)
        if not label:
            return
        low = label.casefold()
        if low in LANGUAGE_NOISE or low in LANGUAGE_BAD_TOKENS:
            return
        if low in seen_low:
            return
        seen_low.add(low)
        seen.append(label)

    for ent in doc.ents:
        if ent.label_ in LANGUAGE_ENT_LABELS:
            add(ent.text)

    buffer: List[str] = []
    for tok in doc:
        if tok.pos_ == "PROPN" and tok.text.lower() not in LANGUAGE_BAD_TOKENS:
            buffer.append(tok.text)
        else:
            if buffer:
                add(" ".join(buffer))
                buffer = []
    if buffer:
        add(" ".join(buffer))

    return seen if seen else None


def _dedupe_by_containment(items: List[str]) -> List[str]:
    lowered = [(it, it.casefold()) for it in items]
    keep: List[str] = []
    for it, low in lowered:
        is_substring_of_other = any(
            low != other_low and low in other_low for _, other_low in lowered
        )
        if is_substring_of_other:
            continue
        if it not in keep:
            keep.append(it)
    return keep


def _split_language_items(text: str) -> List[str]:
    raw = collapse_spaces(text)
    parts = re.split(r"\s*[,;/]\s*|\s+\band\b\s+|\s+\bor\b\s+", raw, flags=re.I)

    regex_items: List[str] = []
    for part in parts:
        label = _clean_language_label(part)
        if not label:
            continue
        if label.casefold() in LANGUAGE_NOISE:
            continue
        regex_items.append(label)

    spacy_items = _split_language_items_spacy(text) or []

    merged = regex_items + [s for s in spacy_items if s not in regex_items]
    if not merged:
        return []
    return _dedupe_by_containment(merged)


def _legislature_orgs_spacy(text: str) -> List[str]:
    doc = _spacy_doc(text)
    if doc is None:
        return []
    return [ent.text for ent in doc.ents if ent.label_ == "ORG"]


def split_legislature_roles(text: str) -> Dict[str, str]:
    raw = collapse_spaces(text)
    low = raw.casefold()
    result: Dict[str, str] = {"Legislature": raw}

    candidates: List[str] = _legislature_orgs_spacy(raw)
    if not candidates:
        candidates = [raw]

    for surface in candidates:
        surface_low = surface.casefold()
        for hint, role in sorted(LEGISLATURE_ROLE_HINTS.items(), key=lambda x: len(x[0]), reverse=True):
            if role in result and result.get(role):
                continue
            if re.search(rf"\b{re.escape(hint)}\b", surface_low):
                result[role] = collapse_spaces(surface)
                break

    for hint, role in sorted(LEGISLATURE_ROLE_HINTS.items(), key=lambda x: len(x[0]), reverse=True):
        if role in result:
            continue
        m = re.search(rf"\b{re.escape(hint)}\b", low)
        if m:
            start, end = m.span()
            result[role] = collapse_spaces(raw[start:end])
    return result


def build_language_composition(source: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}

    if isinstance(source, dict):
        for k, v in source.items():
            label = _clean_language_label(k)
            if not label:
                continue
            out[label] = v
        return out

    if isinstance(source, list):
        for item in source:
            if isinstance(item, dict):
                for k, v in item.items():
                    label = _clean_language_label(k)
                    if label:
                        out[label] = v
            else:
                for label in _split_language_items(str(item)):
                    out[label] = "present"
        return out

    if isinstance(source, str):
        raw = collapse_spaces(source)
        parts = re.split(r"\s*[,;/]\s*", raw)
        found_percentage_style = False

        for part in parts:
            if "%" in part:
                found_percentage_style = True
                label = _clean_language_label(part)
                perc = parse_percentage(part)
                if label and perc is not None:
                    out[label] = f"{perc}%"

        if found_percentage_style and out:
            return out

        for label in _split_language_items(raw):
            out[label] = "present"
        return out

    return out


def build_population_composition(source: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}

    if isinstance(source, dict):
        for k, v in source.items():
            label = collapse_spaces(str(k))
            if label:
                out[label] = v
        return out

    if isinstance(source, list):
        for item in source:
            if isinstance(item, dict):
                for k, v in item.items():
                    label = collapse_spaces(str(k))
                    if label:
                        out[label] = v
            else:
                label = collapse_spaces(str(item))
                if label:
                    out[label] = "present"
        return out

    if isinstance(source, str):
        raw = collapse_spaces(source)
        parts = re.split(r"\s*[,;/]\s*|\s+\band\b\s+|\s+\bor\b\s+", raw, flags=re.I)
        for part in parts:
            label = collapse_spaces(part)
            if label:
                out[label] = "present"
        return out

    return out


RELIGION_LEMMA_BUCKETS = {
    "christian": "Christianity", "christianity": "Christianity",
    "catholic": "Christianity", "catholicism": "Christianity",
    "orthodox": "Christianity", "protestant": "Christianity",
    "protestantism": "Christianity", "anglican": "Christianity",
    "lutheran": "Christianity", "evangelical": "Christianity",
    "baptist": "Christianity", "methodist": "Christianity",
    "presbyterian": "Christianity", "pentecostal": "Christianity",
    "mormon": "Christianity",
    "islam": "Islam", "muslim": "Islam", "sunni": "Islam",
    "shia": "Islam", "shiite": "Islam", "alawite": "Islam",
    "ibadi": "Islam",
    "irreligion": "No religion", "irreligious": "No religion",
    "atheist": "No religion", "atheism": "No religion",
    "agnostic": "No religion", "agnosticism": "No religion",
    "nonreligious": "No religion", "unaffiliated": "No religion",
    "secular": "No religion",
    "buddhist": "Other", "buddhism": "Other",
    "hindu": "Other", "hinduism": "Other",
    "jewish": "Other", "judaism": "Other", "jew": "Other",
    "sikh": "Other", "sikhism": "Other",
    "jain": "Other", "jainism": "Other",
    "shinto": "Other", "shintoism": "Other",
    "taoist": "Other", "taoism": "Other",
    "druze": "Other", "bahai": "Other", "baha": "Other",
    "animist": "Other", "animism": "Other",
    "folk": "Other", "traditional": "Other",
}


def _religion_bucket_from_lemmas(label: str) -> Optional[str]:
    doc = _spacy_doc(label)
    if doc is None:
        return None
    for tok in doc:
        if tok.is_punct or tok.is_space or tok.is_stop:
            continue
        lemma = tok.lemma_.lower()
        bucket = RELIGION_LEMMA_BUCKETS.get(lemma)
        if bucket:
            return bucket
        text_low = tok.text.lower()
        if RELIGION_LEMMA_BUCKETS.get(text_low):
            return RELIGION_LEMMA_BUCKETS[text_low]
    return None


def classify_religion_bucket(label: str) -> str:
    low = compare_text(label)
    if low in RELIGION_BUCKETS:
        return RELIGION_BUCKETS[low]

    spacy_bucket = _religion_bucket_from_lemmas(label)
    if spacy_bucket is not None:
        return spacy_bucket

    if "christ" in low or "cathol" in low or "orthodox" in low or "protest" in low:
        return "Christianity"
    if "islam" in low or "muslim" in low or "sunni" in low or "shia" in low or "alawite" in low:
        return "Islam"
    if "no religion" in low or "irrelig" in low or "athe" in low or "agnostic" in low:
        return "No religion"
    return "Other"


def normalize_religion_composition(source: Any) -> Dict[str, Any]:
    explicit: Dict[str, float] = {}
    aggregated: Dict[str, float] = {}

    def add_pair(label: str, value: Any) -> None:
        bucket = classify_religion_bucket(label)
        num = parse_percentage(scalar_to_raw_text(value))
        if num is None:
            return

        low = compare_text(label)
        is_explicit = (
            (bucket == "Christianity" and low == "christianity") or
            (bucket == "Islam" and low == "islam") or
            (bucket == "No religion" and low in {"no religion", "irreligion"}) or
            (bucket == "Other" and low in {"other", "other religions"})
        )

        if is_explicit:
            explicit[bucket] = num
        else:
            aggregated[bucket] = aggregated.get(bucket, 0.0) + num

    if isinstance(source, dict):
        for k, v in source.items():
            add_pair(str(k), v)
    elif isinstance(source, list):
        for item in source:
            if isinstance(item, dict):
                for k, v in item.items():
                    add_pair(str(k), v)
            else:
                text = scalar_to_raw_text(item)
                add_pair(text, text)
    elif isinstance(source, str):
        parts = re.split(r"\s*[,;/]\s*", source)
        for part in parts:
            add_pair(part, part)

    out: Dict[str, Any] = {}
    for bucket in ["Christianity", "Islam", "No religion", "Other"]:
        if bucket in explicit:
            out[bucket] = f"{explicit[bucket]}%"
        elif bucket in aggregated:
            out[bucket] = f"{aggregated[bucket]}%"
    return out


def maybe_normalize_schema(obj: Any, path: Tuple[str, ...]) -> Any:
    """
    Path-aware schema normalization before generic recursion.
    """
    if not isinstance(obj, dict):
        return obj

    path_low = tuple(p.casefold() for p in path)

    
    if path_low[-1:] == ("government",):
        new_obj: Dict[str, Any] = {}
        for raw_key, raw_val in obj.items():
            key = canonicalize_key(raw_key)
            if key == "Legislature" and isinstance(raw_val, str):
                pieces = split_legislature_roles(raw_val)
                for pk, pv in pieces.items():
                    if pk not in new_obj:
                        new_obj[pk] = pv
                continue
            new_obj[key] = raw_val
        return new_obj

    
    if path_low[-1:] == ("general",):
        new_obj: Dict[str, Any] = {}
        language_bucket: Dict[str, Any] = {}
        demographic_bucket: Dict[str, Any] = {}

        for raw_key, raw_val in obj.items():
            key = canonicalize_key(raw_key)

            if key in DETAIL_LABELS_CLEAN:
                continue

            if key in {
                "Official languages",
                "Official regional languages",
                "Recognized national languages",
                "Recognized minority languages",
                "National languages",
                "Local vernacular",
            }:
                language_bucket[key] = raw_val
                continue

            if key in {"Population composition", "Religion"}:
                demographic_bucket[key] = raw_val
                continue

            new_obj[key] = raw_val

        if language_bucket:
            lang_tree: Dict[str, Any] = {}
            for k, v in language_bucket.items():
                if k == "Official languages":
                    lang_tree["Official"] = build_language_composition(v)
                elif k == "Official regional languages":
                    lang_tree["Regional"] = build_language_composition(v)
                elif k == "Recognized national languages":
                    lang_tree["Recognized national"] = build_language_composition(v)
                elif k == "Recognized minority languages":
                    lang_tree["Recognized minority"] = build_language_composition(v)
                elif k == "National languages":
                    lang_tree["National"] = build_language_composition(v)
                elif k == "Local vernacular":
                    lang_tree["Vernacular"] = build_language_composition(v)
            new_obj["Language composition"] = lang_tree

        if demographic_bucket:
            dem_tree: Dict[str, Any] = {}
            if "Population composition" in demographic_bucket:
                dem_tree["Population composition"] = build_population_composition(demographic_bucket["Population composition"])
            if "Religion" in demographic_bucket:
                dem_tree["Religion"] = normalize_religion_composition(demographic_bucket["Religion"])
            if dem_tree:
                new_obj["Demographics"] = dem_tree

        return new_obj

    return obj




NUM_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
MULTIPLIERS = {
    "thousand": 1_000.0,
    "million": 1_000_000.0,
    "billion": 1_000_000_000.0,
    "trillion": 1_000_000_000_000.0,
}


def first_number(text: str) -> Optional[float]:
    m = NUM_RE.search(text)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def parse_percentage(text: str) -> Optional[float]:
    low = collapse_spaces(text).casefold()
    if "negligible" in low:
        return 0.0
    return first_number(low)


def parse_money(text: str) -> Optional[float]:
    low = collapse_spaces(text).casefold()
    base = first_number(low)
    if base is None:
        return None
    for word, mult in MULTIPLIERS.items():
        if word in low:
            return base * mult
    return base


def parse_area_total_km2(text: str) -> Optional[float]:
    low = collapse_spaces(text).casefold()
    if "negligible" in low:
        return 0.0
    return first_number(low)


def parse_density(text: str) -> Optional[float]:
    low = collapse_spaces(text).casefold()
    m = re.search(r"(-?\d[\d,]*(?:\.\d+)?)\s*/?\s*km", low)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return first_number(low)


def parse_population_count(text: str) -> Optional[float]:
    low = collapse_spaces(text).casefold()

    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*-\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)", low)
    if m:
        return float(m.group(1).replace(",", "")) * MULTIPLIERS[m.group(3)]

    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)", low)
    if m:
        return float(m.group(1).replace(",", "")) * MULTIPLIERS[m.group(2)]

    return first_number(low)


def parse_leading_number(text: str) -> Optional[float]:
    return first_number(text)


@dataclass
class NumericFieldInfo:
    field_name: str
    raw_number: float


def detect_numeric_field(path: Sequence[str], raw_text: str) -> Optional[NumericFieldInfo]:
    raw_text = collapse_spaces(raw_text)
    path_low = [p.casefold() for p in path]
    if not path_low:
        return None
    leaf = path_low[-1]
    top = path_low[0]

    if top == "area":
        if leaf == "total_km2":
            value = parse_area_total_km2(raw_text)
            if value is not None:
                return NumericFieldInfo("area_total", value)
        if leaf == "land_km2":
            value = parse_area_total_km2(raw_text)
            if value is not None:
                return NumericFieldInfo("area_land", value)
        if leaf == "water_km2":
            value = parse_area_total_km2(raw_text)
            if value is not None:
                return NumericFieldInfo("area_water", value)
        if leaf == "water (%)":
            value = parse_percentage(raw_text)
            if value is not None:
                return NumericFieldInfo("percentage", value)

    if top == "population":
        if leaf == "total" or "estimate" in leaf or "census" in leaf or leaf == "population":
            value = parse_population_count(raw_text)
            if value is not None:
                return NumericFieldInfo("population", value)
        if "density" in leaf:
            value = parse_density(raw_text)
            if value is not None:
                return NumericFieldInfo("density", value)

    if top in {"gdp ppp", "gdp nominal", "gdp (ppp)", "gdp (nominal)"}:
        if leaf == "total":
            value = parse_money(raw_text)
            if value is not None:
                return NumericFieldInfo("gdp_total", value)
        if leaf in {"per_capita", "per capita"}:
            value = parse_money(raw_text)
            if value is not None:
                return NumericFieldInfo("gdp_per_capita", value)

    if top == "gini" or leaf == "gini":
        value = parse_leading_number(raw_text)
        if value is not None:
            return NumericFieldInfo("gini", value)

    if top == "hdi" or leaf == "hdi":
        value = parse_leading_number(raw_text)
        if value is not None:
            return NumericFieldInfo("hdi", value)

    if top in {"religions", "religion", "ethnic groups", "population composition", "language composition"}:
        value = parse_percentage(raw_text)
        if value is not None:
            return NumericFieldInfo("percentage", value)

    if re.fullmatch(r"-?\d[\d,]*(?:\.\d+)?", raw_text):
        try:
            value = float(raw_text.replace(",", ""))
        except ValueError:
            return None
        field_name = "auto::" + " / ".join(path_low)
        return NumericFieldInfo(field_name, value)

    return None


QUANTILE_FIELDS = {
    "gdp_total",
    "gdp_per_capita",
    "population",
    "area_total",
    "area_land",
    "area_water",
    "density",
}


@dataclass
class NumericStats:
    field_name: str
    min_value: float
    max_value: float
    sorted_values: Optional[List[float]] = None


class DatasetNumericNormalizer:
    def __init__(self, stats: Dict[str, NumericStats]):
        self.stats = stats

    @classmethod
    def fit(cls, dataset: List[Dict[str, Any]]) -> "DatasetNumericNormalizer":
        buckets: Dict[str, List[float]] = {}

        for country_doc in dataset:
            cls._collect_from_obj(country_doc, (), buckets)

        stats: Dict[str, NumericStats] = {}
        for field_name, values in buckets.items():
            if not values:
                continue
            use_quantile = (
                field_name in QUANTILE_FIELDS or field_name.startswith("auto::")
            )
            sorted_vals = sorted(values) if use_quantile else None
            stats[field_name] = NumericStats(
                field_name, min(values), max(values), sorted_vals
            )

        return cls(stats)

    @classmethod
    def _collect_from_obj(
        cls,
        obj: Any,
        path: Tuple[str, ...],
        buckets: Dict[str, List[float]],
    ) -> None:
        if USE_SCHEMA_NORMALIZATION:
            obj = maybe_normalize_schema(obj, path)

        if isinstance(obj, dict):
            for raw_key, raw_value in obj.items():
                key = canonicalize_key(raw_key) if USE_SCHEMA_NORMALIZATION else str(raw_key)
                cls._collect_from_obj(raw_value, path + (key,), buckets)
            return

        if isinstance(obj, list):
            for item in obj:
                cls._collect_from_obj(item, path + ("item",), buckets)
            return

        raw_text = scalar_to_raw_text(obj)
        info = detect_numeric_field(path, raw_text)
        if info is None:
            return

        buckets.setdefault(info.field_name, []).append(info.raw_number)

    def normalize(self, field_name: str, raw_number: float) -> float:
        if field_name == "hdi":
            return min(max(raw_number, 0.0), 1.0)

        if field_name == "gini":
            return min(max(raw_number / 100.0, 0.0), 1.0)

        if field_name == "percentage":
            return min(max(raw_number / 100.0, 0.0), 1.0)

        stats = self.stats.get(field_name)
        if stats is None:
            return raw_number

        use_quantile = (
            field_name in QUANTILE_FIELDS or field_name.startswith("auto::")
        )
        if use_quantile and stats.sorted_values:
            sv = stats.sorted_values
            n = len(sv)
            if n <= 1:
                return 0.0
            lo = bisect.bisect_left(sv, raw_number)
            hi = bisect.bisect_right(sv, raw_number)
            rank = (lo + hi) / 2.0
            return min(1.0, max(0.0, rank / (n - 1)))

        if math.isclose(stats.min_value, stats.max_value):
            return 0.0

        return (raw_number - stats.min_value) / (stats.max_value - stats.min_value)




def is_url_like(text: str) -> bool:
    low = text.casefold()
    return low.startswith("http://") or low.startswith("https://") or "www." in low


def is_code_like(path: Sequence[str], text: str) -> bool:
    leaf = path[-1].casefold() if path else ""
    joined = " / ".join(p.casefold() for p in path)

    exact_fields = {
        "calling code",
        "calling codes",
        "iso 3166 code",
        "internet tld",
        "tld",
        "time zone",
        "time zones",
        "date format",
        "driving side",
        "currency code",
    }

    if leaf in exact_fields:
        return True

    return any(word in joined for word in ("code", "tld", "utc", "timezone", "time zone"))




def normalize_document(
    obj: Any,
    numeric_normalizer: DatasetNumericNormalizer,
    path: Tuple[str, ...] = (),
) -> Any:
    if USE_SCHEMA_NORMALIZATION:
        obj = maybe_normalize_schema(obj, path)

    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for raw_key, raw_value in obj.items():
            key = canonicalize_key(raw_key) if USE_SCHEMA_NORMALIZATION else str(raw_key)
            child_path = path + (key,)
            value = normalize_document(raw_value, numeric_normalizer, child_path)
            if key in out:
                out[key] = merge_values(out[key], value)
            else:
                out[key] = value
        return out

    if isinstance(obj, list):
        return [normalize_document(x, numeric_normalizer, path + ("item",)) for x in obj]

    raw_text = scalar_to_raw_text(obj)
    info = detect_numeric_field(path, raw_text)

    if info is not None:
        norm_number = numeric_normalizer.normalize(info.field_name, info.raw_number)
        return {
            "__leaf__": True,
            "kind": "numeric",
            "raw": raw_text,
            "norm": f"{norm_number:.12f}",
            "norm_number": norm_number,
            "raw_number": info.raw_number,
            "field_name": info.field_name,
        }

    return {
        "__leaf__": True,
        "kind": "atomic_text",
        "raw": raw_text,
        "norm": compare_text(raw_text),
    }




TOP_SECTION_LABELS = {
    "General", "Government", "Area", "Population", "Economy",
    "Demographics", "Administrative details",
}


def _iter_dict_canonical(value: Dict[str, Any]):
    if CANONICAL_SORT_KEYS:
        return sorted(value.items(), key=lambda kv: str(kv[0]).casefold())
    return value.items()


def build_subtree(
    label: str,
    value: Any,
    top_section: Optional[str] = None,
    depth: int = 1,
) -> TreeNode:
    current_top_section = top_section
    if label in TOP_SECTION_LABELS:
        current_top_section = label

    if isinstance(value, dict) and value.get("__leaf__") is True:
        kind = value["kind"]

        if kind == "numeric":
            return TreeNode(
                label=label,
                raw_value=value["raw"],
                norm_value=value["norm"],
                norm_number=value["norm_number"],
                kind="numeric",
                top_section=current_top_section,
                numeric_field=value.get("field_name"),
                depth=depth,
            )

        if kind == "atomic_text":
            return TreeNode(
                label=label,
                raw_value=value["raw"],
                norm_value=value["norm"],
                kind="atomic_text",
                top_section=current_top_section,
                depth=depth,
            )

    if isinstance(value, dict):
        node = TreeNode(
            label=label,
            kind="internal",
            top_section=current_top_section,
            depth=depth,
        )
        for k, v in _iter_dict_canonical(value):
            node.children.append(build_subtree(k, v, current_top_section, depth + 1))
        return node

    if isinstance(value, list):
        node = TreeNode(
            label=label,
            kind="internal",
            top_section=current_top_section,
            depth=depth,
        )
        for item in value:
            node.children.append(build_subtree("item", item, current_top_section, depth + 1))
        return node

    raw_text = scalar_to_raw_text(value)
    return TreeNode(
        label=label,
        raw_value=raw_text,
        norm_value=compare_text(raw_text),
        kind="atomic_text",
        top_section=current_top_section,
        depth=depth,
    )


def build_tree_from_country_json(
    country_doc: Dict[str, Any],
    numeric_normalizer: DatasetNumericNormalizer,
) -> TreeNode:
    normalized = normalize_document(country_doc, numeric_normalizer)

    root = TreeNode(label="country_document", kind="internal", top_section=None, depth=0)
    for k, v in _iter_dict_canonical(normalized):
        root.children.append(build_subtree(k, v, None, depth=1))
    return root




def extract_tokens(node: TreeNode) -> List[str]:
    tokens: List[str] = []
    if not node.children:
        return tokens

    for child in node.children:
        if child.label == "#text":
            for tok in child.children:
                tokens.append(tok.label)
    return tokens




INSERT_DELETE_PENALTY_MULTIPLIER = 2.0
STRUCTURE_MISMATCH_MULTIPLIER = 3.0
REORDER_COST = 0.25
NUMERIC_VALUE_TOLERANCE = 0.02
NUMERIC_VALUE_WEIGHT = 3.0
NUMERIC_VALUE_MODE = "linear"  # "linear" or "quadratic"
TEXT_VALUE_COST = 0.0

USE_SEMANTIC_LABELS = True
SEMANTIC_MODEL_NAME = "all-MiniLM-L6-v2"
SEMANTIC_MIN_LABEL_LEN = 3
SEMANTIC_MATCH_THRESHOLD = 0.65

# Project 1 enhancements (Tekli Journal_7 / Ch. 5 ongoing solutions).
USE_DEPTH_FACTOR = True              # D-factor(d) = 1/(1+d) on label update cost
USE_SECTION_GUARD = True             # penalise updates across incompatible top-sections
SECTION_MISMATCH_MULTIPLIER = 2.0
CANONICAL_SORT_KEYS = True           # sort dict children at build time for stable DP alignment

USE_SEMANTIC_SUBTREES = True         # Sem_RBS fallback in tree insert/delete cost (Journal_7 §4.3)
SUBTREE_SEMANTIC_THRESHOLD = 0.80    # cosine threshold over mean-pooled label embeddings
SUBTREE_SEMANTIC_MAX_DEPTH = 2       # how deep we scan a tree when looking for a soft match

_SBERT_MODEL = None
_SBERT_DISABLED = False
_EMBEDDING_CACHE: Dict[str, Any] = {}


def _get_sbert_model():
    global _SBERT_MODEL, _SBERT_DISABLED
    if _SBERT_DISABLED:
        return None
    if _SBERT_MODEL is None:
        try:
            from sentence_transformers import SentenceTransformer
            _SBERT_MODEL = SentenceTransformer(SEMANTIC_MODEL_NAME)
        except Exception as exc:
            _SBERT_DISABLED = True
            print(f"[semantic-labels] disabled, falling back to Levenshtein only ({exc})")
            return None
    return _SBERT_MODEL


def _get_embedding(text: str):
    cached = _EMBEDDING_CACHE.get(text)
    if cached is not None:
        return cached
    model = _get_sbert_model()
    if model is None:
        return None
    vec = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
    _EMBEDDING_CACHE[text] = vec
    return vec


def semantic_similarity(s1: str, s2: str) -> Optional[float]:
    if not s1 or not s2:
        return None
    if len(s1) < SEMANTIC_MIN_LABEL_LEN or len(s2) < SEMANTIC_MIN_LABEL_LEN:
        return None
    e1 = _get_embedding(s1)
    e2 = _get_embedding(s2)
    if e1 is None or e2 is None:
        return None
    sim = float((e1 * e2).sum())
    return max(0.0, min(1.0, sim))


def _hybrid_label_similarity(s1: str, s2: str) -> float:
    lev = levenshtein_similarity(s1, s2)
    if not USE_SEMANTIC_LABELS:
        return lev
    sem = semantic_similarity(s1, s2)
    if sem is None:
        return lev
    return max(lev, sem)


def levenshtein(s1: str, s2: str) -> int:
    if s1 == s2:
        return 0
    if not s1:
        return len(s2)
    if not s2:
        return len(s1)

    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1, 1):
        curr = [i]
        for j, c2 in enumerate(s2, 1):
            ins = curr[j - 1] + 1
            dele = prev[j] + 1
            sub = prev[j - 1] + (0 if c1 == c2 else 1)
            curr.append(min(ins, dele, sub))
        prev = curr
    return prev[-1]


def levenshtein_similarity(s1: str, s2: str) -> float:
    s1 = s1 or ""
    s2 = s2 or ""
    max_len = max(len(s1), len(s2))
    if max_len == 0:
        return 1.0
    return 1.0 - (levenshtein(s1, s2) / max_len)


def label_match_threshold(s1: str, s2: str) -> float:
    """
    Dynamic threshold scaled to label length. Short keys ('bc' vs 'c')
    tolerate more relative edits; long keys demand near-identity.
    """
    max_len = max(len(s1), len(s2), 1)
    allowed_edits = max(1, max_len // 3)
    return 1.0 - (allowed_edits / max_len)


def label_similarity(a: TreeNode, b: TreeNode) -> float:
    return _hybrid_label_similarity(compare_text(a.label), compare_text(b.label))


def same_label(a: TreeNode, b: TreeNode) -> bool:
    s1 = compare_text(a.label)
    s2 = compare_text(b.label)
    lev = levenshtein_similarity(s1, s2)
    if lev >= label_match_threshold(s1, s2):
        return True
    if USE_SEMANTIC_LABELS:
        sem = semantic_similarity(s1, s2)
        if sem is not None and sem >= SEMANTIC_MATCH_THRESHOLD:
            return True
    return False


def same_node(a: TreeNode, b: TreeNode) -> bool:
    if not same_label(a, b):
        return False

    if a.kind == "numeric" and b.kind == "numeric":
        if a.norm_number is None or b.norm_number is None:
            return False
        return math.isclose(a.norm_number, b.norm_number, abs_tol=1e-12)

    if a.norm_value is None and b.norm_value is None:
        return True

    return compare_text(a.norm_value) == compare_text(b.norm_value)


def subtree_size(node: TreeNode) -> int:
    return 1 + sum(subtree_size(child) for child in node.children)


def value_update_cost(a: TreeNode, b: TreeNode) -> float:
    if not a.is_leaf() or not b.is_leaf():
        return 0.0

    if (
        a.raw_value is None and a.norm_value is None and a.norm_number is None
        and b.raw_value is None and b.norm_value is None and b.norm_number is None
    ):
        return 0.0

    if a.kind == "numeric" and b.kind == "numeric":
        if a.norm_number is None or b.norm_number is None:
            return NUMERIC_VALUE_WEIGHT
        diff = max(0.0, abs(a.norm_number - b.norm_number) - NUMERIC_VALUE_TOLERANCE)
        if NUMERIC_VALUE_MODE == "quadratic":
            return (diff * diff) * NUMERIC_VALUE_WEIGHT
        return diff * NUMERIC_VALUE_WEIGHT

    if a.kind == "atomic_text" and b.kind == "atomic_text":
        return TEXT_VALUE_COST

    if a.kind == "token" and b.kind == "token":
        return TEXT_VALUE_COST

    return TEXT_VALUE_COST


def _d_factor(depth: int) -> float:
    """Tekli depth attenuation: root-level edits hurt more than deep-leaf ones."""
    if not USE_DEPTH_FACTOR:
        return 1.0
    if depth < 0:
        depth = 0
    return 1.0 / (1.0 + depth)


def _section_mismatch(a: TreeNode, b: TreeNode) -> bool:
    if not USE_SECTION_GUARD:
        return False
    if a.top_section is None and b.top_section is None:
        return False
    return a.top_section != b.top_section


def cost_upd(a: TreeNode, b: TreeNode) -> float:
    s1 = compare_text(a.label)
    s2 = compare_text(b.label)
    lev = levenshtein_similarity(s1, s2)
    sim = _hybrid_label_similarity(s1, s2)
    label_cost = 1.0 - sim

    lev_ok = lev >= label_match_threshold(s1, s2)
    sem_ok = False
    if USE_SEMANTIC_LABELS and not lev_ok:
        sem = semantic_similarity(s1, s2)
        sem_ok = sem is not None and sem >= SEMANTIC_MATCH_THRESHOLD

    if not (lev_ok or sem_ok):
        label_cost *= STRUCTURE_MISMATCH_MULTIPLIER

    if _section_mismatch(a, b):
        label_cost *= SECTION_MISMATCH_MULTIPLIER

    label_cost *= _d_factor(a.depth)

    value_cost = value_update_cost(a, b)
    return label_cost + value_cost


_SUBTREE_VECTOR_CACHE: Dict[int, Any] = {}


def _collect_label_bag(node: TreeNode, bag: List[str]) -> None:
    label = compare_text(node.label)
    if label and len(label) >= SEMANTIC_MIN_LABEL_LEN:
        bag.append(label)
    for child in node.children:
        _collect_label_bag(child, bag)


def subtree_semantic_vector(node: TreeNode):
    """
    Sem_RBS (Tekli Journal_7 §4.3): mean-pooled SBERT embedding over the bag of
    semantically meaningful labels in `node`'s subtree. Used as a soft signal
    for whether two sub-trees describe the same kind of information.
    """
    if not USE_SEMANTIC_SUBTREES:
        return None

    key = id(node)
    cached = _SUBTREE_VECTOR_CACHE.get(key)
    if cached is not None:
        return cached

    model = _get_sbert_model()
    if model is None:
        return None

    bag: List[str] = []
    _collect_label_bag(node, bag)
    if not bag:
        return None

    try:
        import numpy as np
        embs = model.encode(bag, normalize_embeddings=True, show_progress_bar=False)
        embs = np.asarray(embs, dtype="float32")
        if embs.ndim == 1:
            vec = embs
        else:
            vec = embs.mean(axis=0)
        norm = float((vec * vec).sum()) ** 0.5
        if norm > 0:
            vec = vec / norm
    except Exception:
        return None

    _SUBTREE_VECTOR_CACHE[key] = vec
    return vec


def _cosine_unit(v1, v2) -> float:
    if v1 is None or v2 is None:
        return 0.0
    try:
        return max(0.0, min(1.0, float((v1 * v2).sum())))
    except Exception:
        return 0.0


def sem_rbs(a: TreeNode, b: TreeNode) -> float:
    va = subtree_semantic_vector(a)
    vb = subtree_semantic_vector(b)
    return _cosine_unit(va, vb)


def _subtree_best_semantic_match(
    pattern: TreeNode,
    tree: TreeNode,
    remaining_depth: int,
    best_so_far: float,
) -> float:
    """Best cosine between `pattern` and any sub-tree of `tree` up to depth limit."""
    score = sem_rbs(pattern, tree)
    if score > best_so_far:
        best_so_far = score
    if remaining_depth <= 0 or best_so_far >= 0.999:
        return best_so_far
    for child in tree.children:
        best_so_far = _subtree_best_semantic_match(
            pattern, child, remaining_depth - 1, best_so_far
        )
        if best_so_far >= 0.999:
            break
    return best_so_far


def semantically_similar_subtree(pattern: TreeNode, tree: TreeNode) -> Optional[float]:
    """Return the best Sem_RBS score within depth limit if ≥ threshold, else None."""
    if not USE_SEMANTIC_SUBTREES:
        return None
    if subtree_size(pattern) <= 1:
        # Single leaf semantics is already covered by `cost_upd` label similarity.
        return None
    best = _subtree_best_semantic_match(
        pattern, tree, SUBTREE_SEMANTIC_MAX_DEPTH, 0.0
    )
    if best >= SUBTREE_SEMANTIC_THRESHOLD:
        return best
    return None


def contained_in(pattern: TreeNode, target: TreeNode) -> bool:
    if not same_node(pattern, target):
        return False

    p_children = pattern.children
    t_children = target.children

    t_idx = 0
    for p_child in p_children:
        found = False
        while t_idx < len(t_children):
            if contained_in(p_child, t_children[t_idx]):
                found = True
                t_idx += 1
                break
            t_idx += 1
        if not found:
            return False

    return True


def contained_anywhere(pattern: TreeNode, tree: TreeNode, memo: Dict[Tuple[int, int], bool]) -> bool:
    key = (id(pattern), id(tree))
    if key in memo:
        return memo[key]

    if contained_in(pattern, tree):
        memo[key] = True
        return True

    for child in tree.children:
        if contained_anywhere(pattern, child, memo):
            memo[key] = True
            return True

    memo[key] = False
    return False


def _soft_reorder_cost(subtree: TreeNode, sim_score: float) -> float:
    """
    Subtree is *semantically* similar but not structurally contained. Charge a
    cost that is between REORDER_COST and the full insert/delete penalty, scaled
    by (1 - similarity) and the subtree size. This realises Tekli's hybrid TOC
    where high Sem_RBS shrinks the tree operation cost (Journal_7 §4.4).
    """
    size = float(subtree_size(subtree))
    full_penalty = INSERT_DELETE_PENALTY_MULTIPLIER * size
    return REORDER_COST + (1.0 - sim_score) * (full_penalty - REORDER_COST)


def cost_ins_tree(subtree: TreeNode, source_tree: TreeNode, contain_memo: Dict[Tuple[int, int], bool]) -> float:
    if contained_anywhere(subtree, source_tree, contain_memo):
        return REORDER_COST
    sim = semantically_similar_subtree(subtree, source_tree)
    if sim is not None:
        return _soft_reorder_cost(subtree, sim)
    return INSERT_DELETE_PENALTY_MULTIPLIER * float(subtree_size(subtree))


def cost_del_tree(subtree: TreeNode, dest_tree: TreeNode, contain_memo: Dict[Tuple[int, int], bool]) -> float:
    if contained_anywhere(subtree, dest_tree, contain_memo):
        return REORDER_COST
    sim = semantically_similar_subtree(subtree, dest_tree)
    if sim is not None:
        return _soft_reorder_cost(subtree, sim)
    return INSERT_DELETE_PENALTY_MULTIPLIER * float(subtree_size(subtree))




def nj_ted_cost(
    a: TreeNode,
    b: TreeNode,
    memo: Optional[Dict[Tuple[int, int], float]] = None,
    contain_memo: Optional[Dict[Tuple[int, int], bool]] = None,
) -> float:
    if memo is None:
        memo = {}
    if contain_memo is None:
        contain_memo = {}

    key = (id(a), id(b))
    if key in memo:
        return memo[key]

    m = len(a.children)
    n = len(b.children)
    dist = [[0.0] * (n + 1) for _ in range(m + 1)]
    dist[0][0] = cost_upd(a, b)

    for i in range(1, m + 1):
        dist[i][0] = dist[i - 1][0] + cost_del_tree(a.children[i - 1], b, contain_memo)

    for j in range(1, n + 1):
        dist[0][j] = dist[0][j - 1] + cost_ins_tree(b.children[j - 1], a, contain_memo)

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            sub_cost = nj_ted_cost(a.children[i - 1], b.children[j - 1], memo, contain_memo)
            delete_cost = dist[i - 1][j] + cost_del_tree(a.children[i - 1], b, contain_memo)
            insert_cost = dist[i][j - 1] + cost_ins_tree(b.children[j - 1], a, contain_memo)
            match_cost = dist[i - 1][j - 1] + sub_cost
            dist[i][j] = min(match_cost, delete_cost, insert_cost)

    memo[key] = dist[m][n]
    return dist[m][n]


def normalized_similarity(a: TreeNode, b: TreeNode) -> float:
    memo: Dict[Tuple[int, int], float] = {}
    contain_memo: Dict[Tuple[int, int], bool] = {}
    dist = nj_ted_cost(a, b, memo, contain_memo)
    max_cost = INSERT_DELETE_PENALTY_MULTIPLIER * float(subtree_size(a) + subtree_size(b))
    if math.isclose(max_cost, 0.0):
        return 1.0
    return max(0.0, 1.0 - (dist / max_cost))




def child_path(parent_path: str, child: TreeNode, index_1_based: int) -> str:
    if not parent_path:
        return f"{child.label}[{index_1_based}]"
    return f"{parent_path}/{child.label}[{index_1_based}]"


def rebuild_dist_matrix(
    a: TreeNode,
    b: TreeNode,
    memo: Dict[Tuple[int, int], float],
    contain_memo: Dict[Tuple[int, int], bool],
) -> List[List[float]]:
    m = len(a.children)
    n = len(b.children)
    dist = [[0.0] * (n + 1) for _ in range(m + 1)]
    dist[0][0] = cost_upd(a, b)

    for i in range(1, m + 1):
        dist[i][0] = dist[i - 1][0] + cost_del_tree(a.children[i - 1], b, contain_memo)

    for j in range(1, n + 1):
        dist[0][j] = dist[0][j - 1] + cost_ins_tree(b.children[j - 1], a, contain_memo)

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            sub_cost = memo[(id(a.children[i - 1]), id(b.children[j - 1]))]
            delete_cost = dist[i - 1][j] + cost_del_tree(a.children[i - 1], b, contain_memo)
            insert_cost = dist[i][j - 1] + cost_ins_tree(b.children[j - 1], a, contain_memo)
            match_cost = dist[i - 1][j - 1] + sub_cost
            dist[i][j] = min(match_cost, delete_cost, insert_cost)

    return dist


def recover_edit_script(
    a: TreeNode,
    b: TreeNode,
    path: str = "root",
    memo: Optional[Dict[Tuple[int, int], float]] = None,
    contain_memo: Optional[Dict[Tuple[int, int], bool]] = None,
) -> List[Dict[str, Any]]:
    if memo is None:
        memo = {}
    if contain_memo is None:
        contain_memo = {}

    nj_ted_cost(a, b, memo, contain_memo)
    script: List[Dict[str, Any]] = []

    root_cost = cost_upd(a, b)
    if root_cost > 0:
        script.append(
            {
                "op": "update_value" if same_label(a, b) else "update_node",
                "path": path,
                "from": a.to_dict(),
                "to": b.to_dict(),
                "cost": root_cost,
                "source_uid": a.patch_id,
            }
        )

    dist = rebuild_dist_matrix(a, b, memo, contain_memo)
    i = len(a.children)
    j = len(b.children)
    backtrack_ops: List[Dict[str, Any]] = []

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            sub_cost = memo[(id(a.children[i - 1]), id(b.children[j - 1]))]
            if math.isclose(dist[i][j], dist[i - 1][j - 1] + sub_cost, abs_tol=1e-9):
                src_child = a.children[i - 1]
                dst_child = b.children[j - 1]
                src_path = child_path(path, src_child, i)
                backtrack_ops.extend(recover_edit_script(src_child, dst_child, src_path, memo, contain_memo))
                i -= 1
                j -= 1
                continue

        if i > 0:
            del_cost = cost_del_tree(a.children[i - 1], b, contain_memo)
            if math.isclose(dist[i][j], dist[i - 1][j] + del_cost, abs_tol=1e-9):
                src_child = a.children[i - 1]
                src_path = child_path(path, src_child, i)
                backtrack_ops.append(
                    {
                        "op": "delete_tree",
                        "path": src_path,
                        "cost": del_cost,
                        "subtree": src_child.to_dict(),
                        "source_uid": src_child.patch_id,
                    }
                )
                i -= 1
                continue

        if j > 0:
            ins_cost = cost_ins_tree(b.children[j - 1], a, contain_memo)
            if math.isclose(dist[i][j], dist[i][j - 1] + ins_cost, abs_tol=1e-9):
                dst_child = b.children[j - 1]
                backtrack_ops.append(
                    {
                        "op": "insert_tree",
                        "parent_path": path,
                        "index": j,
                        "cost": ins_cost,
                        "subtree": dst_child.to_dict(),
                        "parent_uid": a.patch_id,
                    }
                )
                j -= 1
                continue

        raise RuntimeError("Backtracking failed: no valid predecessor found.")

    backtrack_ops.reverse()
    script.extend(backtrack_ops)
    return script




PATH_SEG_RE = re.compile(r"^(?P<label>.+)\[(?P<index>\d+)\]$")


def _parse_tree_path(path: str) -> List[Tuple[str, int]]:
    """
    Parse a path like:
      root/General[2]/Capital[1]
    into tuples of (label, zero_based_index).
    """
    if not path or path == "root":
        return []

    if path.startswith("root/"):
        path = path[len("root/"):]

    parts: List[Tuple[str, int]] = []
    for seg in path.split("/"):
        m = PATH_SEG_RE.match(seg)
        if not m:
            raise ValueError(f"Invalid tree path segment: {seg}")
        parts.append((m.group("label"), int(m.group("index")) - 1))
    return parts


def _node_from_dict(data: Dict[str, Any]) -> TreeNode:
    node = TreeNode(
        label=data["label"],
        raw_value=data.get("raw_value"),
        norm_value=data.get("norm_value"),
        norm_number=data.get("norm_number"),
        kind=data.get("kind", "internal"),
        top_section=data.get("top_section"),
        numeric_field=data.get("numeric_field"),
        patch_id=data.get("patch_id"),
        depth=int(data.get("depth", 0)),
    )
    for child in data.get("children", []):
        node.children.append(_node_from_dict(child))
    return node


def _assign_patch_ids(root: TreeNode) -> None:
    counter = 0

    def visit(node: TreeNode) -> None:
        nonlocal counter
        counter += 1
        node.patch_id = f"n{counter:06d}"
        for child in node.children:
            visit(child)

    visit(root)


def _find_node_by_patch_id(root: TreeNode, patch_id: Optional[str]) -> Optional[TreeNode]:
    if not patch_id:
        return None
    if root.patch_id == patch_id:
        return root
    for child in root.children:
        found = _find_node_by_patch_id(child, patch_id)
        if found is not None:
            return found
    return None


def _find_parent_and_index_by_patch_id(
    root: TreeNode, patch_id: Optional[str]
) -> Tuple[Optional[TreeNode], int]:
    if not patch_id:
        return None, -1

    for idx, child in enumerate(root.children):
        if child.patch_id == patch_id:
            return root, idx
        parent, child_idx = _find_parent_and_index_by_patch_id(child, patch_id)
        if parent is not None:
            return parent, child_idx
    return None, -1


def _apply_node_snapshot_in_place(node: TreeNode, snapshot: Dict[str, Any]) -> None:
    replacement = _node_from_dict(snapshot)
    node.label = replacement.label
    node.raw_value = replacement.raw_value
    node.norm_value = replacement.norm_value
    node.norm_number = replacement.norm_number
    node.kind = replacement.kind
    node.top_section = replacement.top_section
    node.numeric_field = replacement.numeric_field


def _get_node_by_path(root: TreeNode, path: str) -> TreeNode:
    node = root
    for expected_label, idx in _parse_tree_path(path):
        if idx < 0 or idx >= len(node.children):
            raise IndexError(f"Path index out of range in {path}: {expected_label}[{idx + 1}]")
        child = node.children[idx]
        if child.label != expected_label:
            raise ValueError(
                f"Path label mismatch in {path}: expected {expected_label}, found {child.label}"
            )
        node = child
    return node


def _get_parent_and_child_index(root: TreeNode, path: str) -> Tuple[Optional[TreeNode], int]:
    segs = _parse_tree_path(path)
    if not segs:
        return None, -1

    child_idx = segs[-1][1]
    parent_segs = segs[:-1]
    if not parent_segs:
        return root, child_idx

    parent_path = "root/" + "/".join(f"{label}[{idx + 1}]" for label, idx in parent_segs)
    return _get_node_by_path(root, parent_path), child_idx


def _replace_subtree(
    root: TreeNode,
    path: str,
    replacement: TreeNode,
    patch_id: Optional[str] = None,
) -> TreeNode:
    if patch_id:
        node = _find_node_by_patch_id(root, patch_id)
        if node is None:
            raise IndexError(f"Replace failed for patch id {patch_id} (path={path})")
        keep_patch_id = node.patch_id
        _apply_node_snapshot_in_place(node, replacement.to_dict())
        node.patch_id = keep_patch_id
        return root

    segs = _parse_tree_path(path)
    if not segs:
        replacement.patch_id = root.patch_id
        return replacement

    parent, child_idx = _get_parent_and_child_index(root, path)
    if parent is None or child_idx < 0 or child_idx >= len(parent.children):
        raise IndexError(f"Replace failed for path {path}")

    replacement.patch_id = parent.children[child_idx].patch_id
    parent.children[child_idx] = replacement
    return root


def _delete_subtree(root: TreeNode, path: str, patch_id: Optional[str] = None) -> TreeNode:
    if patch_id:
        if root.patch_id == patch_id:
            raise ValueError("Deleting the root tree is not allowed.")
        parent, child_idx = _find_parent_and_index_by_patch_id(root, patch_id)
        if parent is None or child_idx < 0:
            raise IndexError(f"Delete failed for patch id {patch_id} (path={path})")
        del parent.children[child_idx]
        return root

    segs = _parse_tree_path(path)
    if not segs:
        raise ValueError("Deleting the root tree is not allowed.")

    parent, child_idx = _get_parent_and_child_index(root, path)
    if parent is None or child_idx < 0 or child_idx >= len(parent.children):
        raise IndexError(f"Delete failed for path {path}")

    del parent.children[child_idx]
    return root


def _insert_subtree(
    root: TreeNode,
    parent_path: str,
    index_1_based: int,
    subtree: TreeNode,
    parent_patch_id: Optional[str] = None,
) -> TreeNode:
    parent = _find_node_by_patch_id(root, parent_patch_id) if parent_patch_id else None
    if parent is None:
        parent = _get_node_by_path(root, parent_path)
    insert_idx = max(0, min(index_1_based - 1, len(parent.children)))
    parent.children.insert(insert_idx, subtree)
    return root


def _path_depth(path: str) -> int:
    return len(_parse_tree_path(path))


def _path_last_index(path: str) -> int:
    segs = _parse_tree_path(path)
    return segs[-1][1] if segs else -1


def apply_edit_script_to_tree(source_tree: TreeNode, edit_script: List[Dict[str, Any]]) -> TreeNode:
    """
    Apply ES(T1, T2) to source_tree T1 to reconstruct T2.

    The edit script stores source-based paths for readability, but patching resolves
    nodes primarily through stable source patch ids so it still works after sibling
    insertions, deletions, or ancestor label changes.

    Order of application:
    1) deletes, deepest first and right-to-left
    2) updates, deepest first and right-to-left
    3) inserts, left-to-right within the same parent
    """
    root = source_tree.clone()

    delete_ops = [op for op in edit_script if op["op"] == "delete_tree"]
    update_ops = [op for op in edit_script if op["op"] in {"update_node", "update_value"}]
    insert_ops = [op for op in edit_script if op["op"] == "insert_tree"]

    for op in sorted(delete_ops, key=lambda o: (_path_depth(o["path"]), _path_last_index(o["path"])), reverse=True):
        root = _delete_subtree(root, op["path"], patch_id=op.get("source_uid"))

    for op in sorted(update_ops, key=lambda o: (_path_depth(o["path"]), _path_last_index(o["path"])), reverse=True):
        root = _replace_subtree(root, op["path"], _node_from_dict(op["to"]), patch_id=op.get("source_uid"))

    for op in sorted(insert_ops, key=lambda o: (_path_depth(o["parent_path"]), o["index"])):
        root = _insert_subtree(
            root,
            op["parent_path"],
            op["index"],
            _node_from_dict(op["subtree"]),
            parent_patch_id=op.get("parent_uid"),
        )

    return root


def _node_to_native_value(node: TreeNode, prefer: str = "raw") -> Any:
    if node.kind == "token_text_container":
        return " ".join(extract_tokens(node))

    if node.is_leaf():
        if prefer == "number" and node.norm_number is not None:
            return node.norm_number
        if prefer == "norm" and node.norm_value is not None:
            return node.norm_value
        return node.raw_value if node.raw_value is not None else node.norm_value

    if node.children and all(child.label == "item" for child in node.children):
        return [_node_to_native_value(child, prefer=prefer) for child in node.children]

    out: Dict[str, Any] = {}
    for child in node.children:
        child_value = _node_to_native_value(child, prefer=prefer)
        if child.label in out:
            if not isinstance(out[child.label], list):
                out[child.label] = [out[child.label]]
            out[child.label].append(child_value)
        else:
            out[child.label] = child_value
    return out


def tree_to_native_document(root: TreeNode, prefer: str = "raw") -> Dict[str, Any]:
    if root.label == "country_document":
        out: Dict[str, Any] = {}
        for child in root.children:
            out[child.label] = _node_to_native_value(child, prefer=prefer)
        return out
    return {root.label: _node_to_native_value(root, prefer=prefer)}


def save_tree_as_json(root: TreeNode, out_path: str, prefer: str = "raw") -> None:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(tree_to_native_document(root, prefer=prefer), f, ensure_ascii=False, indent=2)


def _render_infobox_like(obj: Any, indent: int = 0) -> List[str]:
    lines: List[str] = []
    pad = "  " * indent

    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{pad}{k}:")
                lines.extend(_render_infobox_like(v, indent + 1))
            else:
                lines.append(f"{pad}{k}: {v}")
        return lines

    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                lines.append(f"{pad}-")
                lines.extend(_render_infobox_like(item, indent + 1))
            else:
                lines.append(f"{pad}- {item}")
        return lines

    lines.append(f"{pad}{obj}")
    return lines


def tree_to_infobox_text(root: TreeNode, prefer: str = "raw") -> str:
    return "\n".join(_render_infobox_like(tree_to_native_document(root, prefer=prefer)))


def _path_top_section(path: str) -> str:
    """Extract the top-level branch label from a tree path like 'root/Area[1]/...'."""
    if not path:
        return "<root>"
    if path == "root":
        return "<root>"
    if path.startswith("root/"):
        path = path[len("root/"):]
    head = path.split("/", 1)[0]
    m = PATH_SEG_RE.match(head)
    return m.group("label") if m else head


def summarize_edit_script_by_section(
    script: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """
    Aggregate the edit script per top-level section so the report can answer
    Project 1's question "How are A and B similar/different?" at a glance.
    """
    by_section: Dict[str, Dict[str, Any]] = {}
    for op in script:
        path = op.get("path") or op.get("parent_path") or ""
        section = _path_top_section(path)
        bucket = by_section.setdefault(
            section,
            {
                "section": section,
                "total_ops": 0,
                "updates": 0,
                "inserts": 0,
                "deletes": 0,
                "total_cost": 0.0,
            },
        )
        bucket["total_ops"] += 1
        bucket["total_cost"] += float(op.get("cost", 0.0))
        op_name = op.get("op", "")
        if op_name.startswith("update"):
            bucket["updates"] += 1
        elif op_name == "insert_tree":
            bucket["inserts"] += 1
        elif op_name == "delete_tree":
            bucket["deletes"] += 1

    ordered = sorted(
        by_section.values(), key=lambda b: b["total_cost"], reverse=True
    )
    return {b["section"]: b for b in ordered}


def verify_patch(patched_tree: TreeNode, target_tree: TreeNode) -> Dict[str, Any]:
    memo: Dict[Tuple[int, int], float] = {}
    contain_memo: Dict[Tuple[int, int], bool] = {}
    dist = nj_ted_cost(patched_tree, target_tree, memo, contain_memo)
    return {
        "patched_tree_size": subtree_size(patched_tree),
        "target_tree_size": subtree_size(target_tree),
        "distance_after_patch": dist,
        "exact_match": math.isclose(dist, 0.0, abs_tol=1e-9),
    }




def _unwrap_raw_item(item: Any) -> Any:
    """
    Promote a raw-scrape entry of shape {country, url, infobox: {...}} to a flat
    country document compatible with the rest of the pipeline. Idempotent: items
    that don't have a nested `infobox` are returned unchanged.
    """
    if not isinstance(item, dict):
        return item
    infobox = item.get("infobox")
    if not isinstance(infobox, dict):
        return item

    flat: Dict[str, Any] = {}
    flat["Country"] = (
        item.get("country") or item.get("Country") or "unknown"
    )
    # `url` is not useful for structural comparison; drop it. Promote
    # infobox contents to the top level so build_tree_from_country_json
    # sees the same shape it sees for cleaned-data files.
    for k, v in infobox.items():
        flat[k] = v
    return flat


def load_dataset(path: str) -> List[Dict[str, Any]]:
    p = Path(path)

    if p.is_dir():
        dataset: List[Dict[str, Any]] = []
        for file_path in sorted(p.glob("*.json")):
            with open(file_path, "r", encoding="utf-8-sig") as f:
                doc = json.load(f)
            if isinstance(doc, dict):
                doc = _unwrap_raw_item(doc)
                if "Country" not in doc and "country" not in doc:
                    doc["Country"] = file_path.stem
                dataset.append(doc)
        return dataset

    with open(p, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    items: List[Dict[str, Any]]
    if isinstance(data, dict) and "countries" in data:
        items = list(data["countries"])
    elif isinstance(data, list):
        items = list(data)
    else:
        raise ValueError(
            "Unsupported dataset format. Expected a directory of JSON files, "
            "a list, or a dict with a 'countries' key."
        )

    return [_unwrap_raw_item(it) for it in items]


def get_country_doc(dataset: List[Dict[str, Any]], country_name: str) -> Dict[str, Any]:
    wanted = country_name.casefold().strip()
    for item in dataset:
        name = item.get("Country", item.get("country", ""))
        if str(name).casefold().strip() == wanted:
            return item
    raise KeyError(f"Country not found: {country_name}")


def compare_countries(dataset_path: str, country_a: str, country_b: str) -> Dict[str, Any]:
    dataset = load_dataset(dataset_path)
    numeric_normalizer = DatasetNumericNormalizer.fit(dataset)

    doc_a = get_country_doc(dataset, country_a)
    doc_b = get_country_doc(dataset, country_b)

    tree_a = build_tree_from_country_json(doc_a, numeric_normalizer)
    tree_b = build_tree_from_country_json(doc_b, numeric_normalizer)
    _assign_patch_ids(tree_a)

    memo: Dict[Tuple[int, int], float] = {}
    contain_memo: Dict[Tuple[int, int], bool] = {}

    distance = nj_ted_cost(tree_a, tree_b, memo, contain_memo)
    similarity = normalized_similarity(tree_a, tree_b)
    script = recover_edit_script(tree_a, tree_b, "root", memo, contain_memo)

    return {
        "dataset_path": dataset_path,
        "country_a": country_a,
        "country_b": country_b,
        "distance": distance,
        "similarity": similarity,
        "tree_a_size": subtree_size(tree_a),
        "tree_b_size": subtree_size(tree_b),
        "edit_script": script,
        "tree_a": tree_a,
        "tree_b": tree_b,
        "numeric_stats": {
            name: {"min": stats.min_value, "max": stats.max_value}
            for name, stats in numeric_normalizer.stats.items()
        },
    }




# ---------------------------------------------------------------------------
# Project 2: pairwise similarity matrix + clustering (Ch. 10).
# ---------------------------------------------------------------------------

def _country_name(doc: Dict[str, Any], fallback: str = "unknown") -> str:
    name = doc.get("Country") or doc.get("country") or fallback
    return str(name).strip()


def build_distance_matrix(
    dataset_path: str,
    country_filter: Optional[Sequence[str]] = None,
):
    """
    Fit the numeric normalizer once over the full dataset, then build a full
    (countries x countries) TED-distance and similarity matrix. SBERT
    embeddings are warm-pooled by encoding every unique label once up front.

    Returns: (countries, dist_matrix, sim_matrix) where matrices are numpy
    arrays of shape (N, N). Diagonals are 0.0 / 1.0 respectively.
    """
    import numpy as np

    dataset = load_dataset(dataset_path)
    numeric_normalizer = DatasetNumericNormalizer.fit(dataset)

    docs: List[Dict[str, Any]] = []
    countries: List[str] = []
    wanted: Optional[set] = None
    if country_filter:
        wanted = {c.casefold().strip() for c in country_filter}

    for doc in dataset:
        name = _country_name(doc)
        if wanted is not None and name.casefold().strip() not in wanted:
            continue
        docs.append(doc)
        countries.append(name)

    if len(docs) < 2:
        raise ValueError(
            "Need at least 2 countries to build a similarity matrix; "
            f"got {len(docs)}."
        )

    trees = [build_tree_from_country_json(doc, numeric_normalizer) for doc in docs]

    # Warm up the SBERT label cache in a single batched call. This avoids
    # paying per-call encoder overhead inside O(N^2) pairwise comparisons.
    if USE_SEMANTIC_LABELS:
        bag_lookup: set = set()
        for tree in trees:
            stack: List[TreeNode] = [tree]
            while stack:
                node = stack.pop()
                lbl = compare_text(node.label)
                if lbl and len(lbl) >= SEMANTIC_MIN_LABEL_LEN:
                    bag_lookup.add(lbl)
                stack.extend(node.children)
        missing = [t for t in bag_lookup if t not in _EMBEDDING_CACHE]
        model = _get_sbert_model()
        if model is not None and missing:
            try:
                embs = model.encode(
                    missing, normalize_embeddings=True, show_progress_bar=False
                )
                for txt, vec in zip(missing, embs):
                    _EMBEDDING_CACHE[txt] = vec
            except Exception as exc:  # pragma: no cover - defensive
                print(f"[semantic-labels] batch warmup failed: {exc}")

    n = len(countries)
    dist_matrix = np.zeros((n, n), dtype="float32")
    sim_matrix = np.ones((n, n), dtype="float32")

    for i in range(n):
        for j in range(i + 1, n):
            sim = normalized_similarity(trees[i], trees[j])
            # normalized_similarity already runs nj_ted_cost; recover distance
            # from sim to avoid a second TED call.
            max_cost = INSERT_DELETE_PENALTY_MULTIPLIER * float(
                subtree_size(trees[i]) + subtree_size(trees[j])
            )
            dist = (1.0 - sim) * max_cost
            dist_matrix[i, j] = dist
            dist_matrix[j, i] = dist
            sim_matrix[i, j] = sim
            sim_matrix[j, i] = sim

    return countries, dist_matrix, sim_matrix


def _normalize_distance_for_clustering(dist_matrix):
    """Scale pairwise distances to [0, 1] using the matrix maximum so they are
    comparable to the [0, 1] similarity space used in evaluation."""
    import numpy as np
    m = float(np.max(dist_matrix))
    if m <= 0:
        return dist_matrix.astype("float32")
    return (dist_matrix / m).astype("float32")


def agglomerative_cluster(dist_matrix, k: int, linkage: str = "average"):
    """
    Hierarchical agglomerative clustering on a precomputed distance matrix
    (Ch. 10.5.2). Returns (labels, linkage_matrix).
    """
    import numpy as np
    from scipy.cluster.hierarchy import linkage as scipy_linkage
    from scipy.cluster.hierarchy import fcluster
    from scipy.spatial.distance import squareform

    scaled = _normalize_distance_for_clustering(dist_matrix)
    condensed = squareform(scaled, checks=False)
    Z = scipy_linkage(condensed, method=linkage)
    labels = fcluster(Z, t=k, criterion="maxclust")
    return np.asarray(labels, dtype="int32"), Z


def kmeans_cluster(dist_matrix, k: int, embed_dim: int = 10, random_state: int = 42):
    """
    Partitional k-means (Ch. 10.5.1) over an MDS embedding of the distance
    matrix. Returns (labels, embedding).
    """
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.manifold import MDS

    scaled = _normalize_distance_for_clustering(dist_matrix)
    n = scaled.shape[0]
    dim = max(2, min(embed_dim, n - 1))
    mds = MDS(
        n_components=dim,
        dissimilarity="precomputed",
        random_state=random_state,
        normalized_stress="auto",
    )
    embedding = mds.fit_transform(scaled)
    km = KMeans(n_clusters=k, n_init=10, random_state=random_state)
    labels = km.fit_predict(embedding)
    return np.asarray(labels, dtype="int32"), embedding


def compute_internal_metrics(dist_matrix, labels) -> Dict[str, float]:
    """Internal cluster quality (Ch. 10.6 / Journal_7 §6.2)."""
    import numpy as np
    from sklearn.metrics import silhouette_score

    if len(set(labels)) < 2:
        return {"silhouette": float("nan"), "intra_cluster_mean_dist": float("nan")}

    sil = silhouette_score(dist_matrix, labels, metric="precomputed")

    intra = []
    for c in set(labels):
        idxs = np.where(np.asarray(labels) == c)[0]
        if len(idxs) < 2:
            continue
        sub = dist_matrix[np.ix_(idxs, idxs)]
        intra.append(float(sub.sum() / (len(idxs) * (len(idxs) - 1))))
    intra_mean = float(np.mean(intra)) if intra else float("nan")

    return {
        "silhouette": float(sil),
        "intra_cluster_mean_dist": intra_mean,
        "n_clusters": int(len(set(labels))),
    }


def compute_external_metrics(
    labels: Sequence[int],
    reference: Sequence[str],
) -> Dict[str, float]:
    """
    Purity / entropy / F-value vs. an externally supplied reference grouping
    (Ch. 10.6, Journal_7 §6.2). `reference` is a list of class names aligned
    with `labels` by index.
    """
    import numpy as np
    from collections import Counter

    labels_arr = np.asarray(list(labels))
    ref_arr = np.asarray([str(r) for r in reference])
    n = len(labels_arr)
    if n == 0:
        return {"purity": float("nan"), "entropy": float("nan"), "f_value": float("nan")}

    clusters = sorted(set(labels_arr.tolist()))
    classes = sorted(set(ref_arr.tolist()))

    purity_sum = 0.0
    entropy_sum = 0.0
    total = 0
    for c in clusters:
        members = ref_arr[labels_arr == c]
        if len(members) == 0:
            continue
        counts = Counter(members.tolist())
        majority = max(counts.values())
        purity_sum += majority
        total += len(members)
        probs = np.array(list(counts.values()), dtype="float64") / len(members)
        ent = -float((probs * np.log2(np.clip(probs, 1e-12, 1.0))).sum())
        entropy_sum += (len(members) / n) * ent
    purity = purity_sum / total if total else float("nan")

    # F-measure per class, weighted by class size (Ch. 10.6).
    f_scores: List[float] = []
    weights: List[int] = []
    for cls in classes:
        cls_mask = ref_arr == cls
        cls_size = int(cls_mask.sum())
        if cls_size == 0:
            continue
        best_f = 0.0
        for c in clusters:
            clust_mask = labels_arr == c
            tp = int((cls_mask & clust_mask).sum())
            if tp == 0:
                continue
            pr = tp / int(clust_mask.sum())
            rc = tp / cls_size
            f = 2 * pr * rc / (pr + rc) if (pr + rc) else 0.0
            if f > best_f:
                best_f = f
        f_scores.append(best_f)
        weights.append(cls_size)
    f_value = (
        float(sum(f * w for f, w in zip(f_scores, weights)) / sum(weights))
        if weights
        else float("nan")
    )

    return {
        "purity": float(purity),
        "entropy": float(entropy_sum),
        "f_value": float(f_value),
        "n_classes": len(classes),
        "n_clusters": len(clusters),
    }


def export_dendrogram(linkage_matrix, country_names: Sequence[str], out_path: str) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.cluster.hierarchy import dendrogram

    height = max(6.0, 0.25 * len(country_names))
    fig, ax = plt.subplots(figsize=(12, height))
    dendrogram(
        linkage_matrix,
        labels=list(country_names),
        orientation="right",
        leaf_font_size=8,
        ax=ax,
    )
    ax.set_xlabel("Normalised distance")
    ax.set_title("Country similarity dendrogram (TED + Sem_RBS)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)


def _load_reference_labels(path: str) -> Dict[str, str]:
    """Load a CSV with two columns (country, label) or a JSON dict."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)
    if p.suffix.lower() == ".json":
        data = json.loads(p.read_text(encoding="utf-8-sig"))
        return {str(k).strip(): str(v).strip() for k, v in data.items()}

    out: Dict[str, str] = {}
    with p.open("r", encoding="utf-8-sig") as f:
        for line in f:
            row = line.strip()
            if not row or row.startswith("#"):
                continue
            # Accept comma or tab separators.
            sep = "," if "," in row else "\t"
            parts = row.split(sep, 1)
            if len(parts) == 2:
                out[parts[0].strip()] = parts[1].strip()
    return out


def save_distance_matrix_csv(
    countries: Sequence[str], dist_matrix, out_path: str
) -> None:
    rows = [",".join(["country"] + list(countries))]
    for i, name in enumerate(countries):
        row_vals = [f"{dist_matrix[i, j]:.6f}" for j in range(len(countries))]
        rows.append(",".join([name] + row_vals))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(rows))


def run_clustering_pipeline(
    dataset_path: str,
    out_dir: Path,
    k: int,
    linkage: str,
    algorithms: Sequence[str],
    reference_labels_path: Optional[str] = None,
    country_filter: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """End-to-end Project 2 entry point: matrix → clustering → metrics → outputs."""
    out_dir.mkdir(parents=True, exist_ok=True)

    countries, dist_matrix, sim_matrix = build_distance_matrix(
        dataset_path, country_filter=country_filter
    )

    matrix_csv_path = out_dir / "similarity_matrix.csv"
    save_distance_matrix_csv(countries, sim_matrix, str(matrix_csv_path))

    distance_csv_path = out_dir / "distance_matrix.csv"
    save_distance_matrix_csv(countries, dist_matrix, str(distance_csv_path))

    reference_lookup: Optional[Dict[str, str]] = None
    if reference_labels_path:
        reference_lookup = _load_reference_labels(reference_labels_path)

    results: Dict[str, Any] = {
        "n_countries": len(countries),
        "countries": countries,
        "matrix_csv": str(matrix_csv_path),
        "distance_csv": str(distance_csv_path),
        "algorithms": {},
    }

    for algo in algorithms:
        algo_info: Dict[str, Any] = {}
        if algo == "agglomerative":
            labels, Z = agglomerative_cluster(dist_matrix, k=k, linkage=linkage)
            dendro_path = out_dir / f"dendrogram_{linkage}.png"
            try:
                export_dendrogram(Z, countries, str(dendro_path))
                algo_info["dendrogram"] = str(dendro_path)
            except Exception as exc:  # pragma: no cover - matplotlib backend issues
                algo_info["dendrogram_error"] = str(exc)
        elif algo == "kmeans":
            labels, _ = kmeans_cluster(dist_matrix, k=k)
        else:
            raise ValueError(f"Unknown clustering algorithm: {algo}")

        labels_path = out_dir / f"clusters_{algo}.csv"
        with labels_path.open("w", encoding="utf-8") as f:
            f.write("country,cluster\n")
            for name, lbl in zip(countries, labels):
                f.write(f"{name},{int(lbl)}\n")
        algo_info["labels_csv"] = str(labels_path)
        algo_info["internal_metrics"] = compute_internal_metrics(dist_matrix, labels)

        if reference_lookup:
            ref_aligned: List[str] = []
            for name in countries:
                ref_aligned.append(reference_lookup.get(name, "__unknown__"))
            algo_info["external_metrics"] = compute_external_metrics(
                list(labels), ref_aligned
            )

        results["algorithms"][algo] = algo_info

    report_path = out_dir / "clustering_report.json"
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    results["report"] = str(report_path)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def default_dataset_dir(base_dir: Path) -> Path:
    return base_dir.parent / "data" / "cleaned-data"


def _run_compare(args, dataset_path: Path, out_dir: Path) -> None:
    if not args.a or not args.b:
        raise SystemExit("--a and --b are required in compare mode")

    result = compare_countries(
        dataset_path=str(dataset_path),
        country_a=args.a,
        country_b=args.b,
    )

    patched_tree = apply_edit_script_to_tree(result["tree_a"], result["edit_script"])
    verification = verify_patch(patched_tree, result["tree_b"])
    section_summary = summarize_edit_script_by_section(result["edit_script"])

    a_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", args.a.strip())
    b_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", args.b.strip())

    edit_script_path = out_dir / f"edit_script_{a_safe}_to_{b_safe}.json"
    with open(edit_script_path, "w", encoding="utf-8") as f:
        json.dump(result["edit_script"], f, ensure_ascii=False, indent=2)

    summary_path = out_dir / f"diff_summary_{a_safe}_to_{b_safe}.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "country_a": result["country_a"],
                "country_b": result["country_b"],
                "distance": result["distance"],
                "similarity": result["similarity"],
                "tree_a_size": result["tree_a_size"],
                "tree_b_size": result["tree_b_size"],
                "section_summary": section_summary,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    patched_json_path = out_dir / f"patched_{a_safe}_to_{b_safe}.json"
    save_tree_as_json(patched_tree, str(patched_json_path), prefer="raw")

    patched_text_path = out_dir / f"patched_{a_safe}_to_{b_safe}_infobox.txt"
    with open(patched_text_path, "w", encoding="utf-8") as f:
        f.write(tree_to_infobox_text(patched_tree, prefer="raw"))

    target_json_path = out_dir / f"target_{b_safe}.json"
    save_tree_as_json(result["tree_b"], str(target_json_path), prefer="raw")

    print(f"Dataset: {dataset_path}")
    print(f"Source country (A): {result['country_a']}")
    print(f"Target country (B): {result['country_b']}")
    print(f"Distance: {result['distance']:.6f}")
    print(f"Similarity: {result['similarity']:.6f}")
    print(f"Tree A size: {result['tree_a_size']}")
    print(f"Tree B size: {result['tree_b_size']}")

    print("\nPatch verification:")
    print(json.dumps(verification, ensure_ascii=False, indent=2))

    print("\nSection-level diff summary (sorted by total cost):")
    print(json.dumps(section_summary, ensure_ascii=False, indent=2))

    print("\nSaved files:")
    print(f"  Edit script:    {edit_script_path}")
    print(f"  Diff summary:   {summary_path}")
    print(f"  Patched JSON:   {patched_json_path}")
    print(f"  Patched text:   {patched_text_path}")
    print(f"  Target JSON:    {target_json_path}")

    if args.show_tree != "none":
        print("\nTree A:")
        print(result["tree_a"].pretty(show=args.show_tree))
        print("\nTree B:")
        print(result["tree_b"].pretty(show=args.show_tree))
        print("\nPatched Tree:")
        print(patched_tree.pretty(show=args.show_tree))

    print(f"\nFirst {args.ops} edit operations:")
    for op in result["edit_script"][: args.ops]:
        print(json.dumps(op, ensure_ascii=False, indent=2))


def _run_matrix(args, dataset_path: Path, out_dir: Path) -> None:
    country_filter = None
    if args.countries:
        country_filter = [c.strip() for c in args.countries.split(",") if c.strip()]

    countries, dist_matrix, sim_matrix = build_distance_matrix(
        str(dataset_path), country_filter=country_filter
    )

    sim_csv = out_dir / "similarity_matrix.csv"
    dist_csv = out_dir / "distance_matrix.csv"
    save_distance_matrix_csv(countries, sim_matrix, str(sim_csv))
    save_distance_matrix_csv(countries, dist_matrix, str(dist_csv))

    print(f"Countries: {len(countries)}")
    print(f"Similarity matrix: {sim_csv}")
    print(f"Distance matrix:   {dist_csv}")


def _run_cluster(args, dataset_path: Path, out_dir: Path) -> None:
    algorithms: List[str]
    if args.clustering == "both":
        algorithms = ["agglomerative", "kmeans"]
    else:
        algorithms = [args.clustering]

    country_filter = None
    if args.countries:
        country_filter = [c.strip() for c in args.countries.split(",") if c.strip()]

    results = run_clustering_pipeline(
        dataset_path=str(dataset_path),
        out_dir=out_dir,
        k=args.k,
        linkage=args.linkage,
        algorithms=algorithms,
        reference_labels_path=args.reference_labels,
        country_filter=country_filter,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Nierman & Jagadish-style TED + Sem_RBS for country infobox JSON"
    )
    parser.add_argument(
        "--mode",
        choices=["compare", "matrix", "cluster"],
        default="compare",
        help="compare: pairwise TED + diff + patch (Project 1). "
             "matrix: build pairwise similarity / distance matrices. "
             "cluster: matrix + agglomerative/k-means clustering + metrics (Project 2).",
    )
    parser.add_argument("--dataset", default=None, help="Custom dataset path. Defaults to data/cleaned-data.")
    parser.add_argument("--a", default=None, help="Source country (compare mode)")
    parser.add_argument("--b", default=None, help="Target country (compare mode)")
    parser.add_argument("--ops", type=int, default=20, help="How many edit operations to print (compare mode)")
    parser.add_argument("--show-tree", choices=["none", "raw", "norm", "number"], default="none")
    parser.add_argument("--out-dir", default="outputs", help="Directory for outputs")
    parser.add_argument("--countries", default=None,
                        help="Comma-separated country list to restrict matrix/cluster modes")
    parser.add_argument("--k", type=int, default=8, help="Number of clusters (cluster mode)")
    parser.add_argument("--linkage", choices=["single", "complete", "average", "ward"],
                        default="average", help="Agglomerative linkage criterion")
    parser.add_argument("--clustering", choices=["agglomerative", "kmeans", "both"],
                        default="both", help="Which clustering algorithm(s) to run")
    parser.add_argument("--reference-labels", default=None,
                        help="Optional CSV/JSON mapping country -> reference cluster name "
                             "(enables purity/entropy/F-value).")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    dataset_path = Path(args.dataset) if args.dataset else default_dataset_dir(base_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "compare":
        _run_compare(args, dataset_path, out_dir)
    elif args.mode == "matrix":
        _run_matrix(args, dataset_path, out_dir)
    elif args.mode == "cluster":
        _run_cluster(args, dataset_path, out_dir)
    else:  # pragma: no cover - argparse already constrains this
        raise SystemExit(f"Unknown mode: {args.mode}")


if __name__ == "__main__":
    main()
