from __future__ import annotations

import argparse
import copy
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple


# ============================================================
# Tree model
# ============================================================

@dataclass
class TreeNode:
    label: str
    raw_value: Optional[str] = None
    norm_value: Optional[str] = None
    norm_number: Optional[float] = None
    kind: str = "internal"  # internal | numeric | atomic_text | token | token_text_container
    top_section: Optional[str] = None
    numeric_field: Optional[str] = None
    patch_id: Optional[str] = None
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


# ============================================================
# Profiles
# ============================================================

@dataclass(frozen=True)
class PreprocessProfile:
    name: str
    normalize_numbers: bool = True
    keep_raw_metadata: bool = True


RAW_PROFILE = PreprocessProfile(name="raw", normalize_numbers=True, keep_raw_metadata=True)
CLEAN_PROFILE = PreprocessProfile(name="clean", normalize_numbers=True, keep_raw_metadata=True)


def get_profile(mode: str) -> PreprocessProfile:
    mode = mode.strip().lower()
    if mode == "raw":
        return RAW_PROFILE
    if mode == "clean":
        return CLEAN_PROFILE
    raise ValueError(f"Unsupported mode: {mode}")


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


# ============================================================
# Generic text helpers
# ============================================================

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


# ============================================================
# Key normalization / schema normalization
# ============================================================

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

    if low in {"nationality", "ethnicity", "ethnic groups", "ethnic groups / nationality"}:
        return "Population composition"

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
    t = t.strip(" ,;:/")
    return collapse_spaces(t)


def _split_language_items(text: str) -> List[str]:
    raw = collapse_spaces(text)
    parts = re.split(r"\s*[,;/]\s*|\s+\band\b\s+|\s+\bor\b\s+", raw, flags=re.I)

    cleaned: List[str] = []
    for part in parts:
        label = _clean_language_label(part)
        if not label:
            continue
        if label.casefold() in LANGUAGE_NOISE:
            continue
        cleaned.append(label)
    return cleaned


def split_legislature_roles(text: str) -> Dict[str, str]:
    raw = collapse_spaces(text)
    low = raw.casefold()
    result: Dict[str, str] = {"Legislature": raw}

    for hint, role in sorted(LEGISLATURE_ROLE_HINTS.items(), key=lambda x: len(x[0]), reverse=True):
        m = re.search(rf"\b{re.escape(hint)}\b", low)
        if m:
            start, end = m.span()
            surface = raw[start:end]
            result[role] = collapse_spaces(surface)
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


def classify_religion_bucket(label: str) -> str:
    low = compare_text(label)
    if low in RELIGION_BUCKETS:
        return RELIGION_BUCKETS[low]

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


def maybe_normalize_schema(obj: Any, path: Tuple[str, ...], profile: PreprocessProfile) -> Any:
    """
    Path-aware schema normalization before generic recursion.
    """
    if not isinstance(obj, dict):
        return obj

    path_low = tuple(p.casefold() for p in path)

    # Government subtree normalization
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

    # General subtree normalization
    if path_low[-1:] == ("general",):
        new_obj: Dict[str, Any] = {}
        language_bucket: Dict[str, Any] = {}
        demographic_bucket: Dict[str, Any] = {}

        for raw_key, raw_val in obj.items():
            key = canonicalize_key(raw_key)

            if profile.name == "clean" and key in DETAIL_LABELS_CLEAN:
                # Drop detail-only clean fields entirely.
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

            if profile.name == "clean" and key in {"Population composition", "Religion"}:
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


# ============================================================
# Numeric parsing / normalization
# ============================================================

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
    leaf = path_low[-1] if path_low else ""
    joined = " / ".join(path_low)

    if leaf == "water (%)":
        value = parse_percentage(raw_text)
        if value is not None:
            return NumericFieldInfo("percentage", value)

    if "religion" in joined or "population composition" in joined or "language composition" in joined:
        value = parse_percentage(raw_text)
        if value is not None:
            return NumericFieldInfo("percentage", value)

    if "gdp (ppp)" in joined or "gdp (nominal)" in joined:
        if leaf == "total":
            value = parse_money(raw_text)
            if value is not None:
                return NumericFieldInfo("gdp_total", value)
        if leaf == "per capita":
            value = parse_money(raw_text)
            if value is not None:
                return NumericFieldInfo("gdp_per_capita", value)

    if "area" in joined and leaf == "total":
        value = parse_area_total_km2(raw_text)
        if value is not None:
            return NumericFieldInfo("area_total", value)

    if "population" in joined and "density" in leaf:
        value = parse_density(raw_text)
        if value is not None:
            return NumericFieldInfo("density", value)

    if "population" in joined and ("estimate" in leaf or "census" in leaf or leaf in {"population", "total"}):
        value = parse_population_count(raw_text)
        if value is not None:
            return NumericFieldInfo("population", value)

    if leaf == "gini":
        value = parse_leading_number(raw_text)
        if value is not None:
            return NumericFieldInfo("gini", value)

    if leaf == "hdi":
        value = parse_leading_number(raw_text)
        if value is not None:
            return NumericFieldInfo("hdi", value)

    return None


LOG_MINMAX_FIELDS = {"gdp_total", "gdp_per_capita", "population", "area_total", "density"}


@dataclass
class NumericStats:
    field_name: str
    min_value: float
    max_value: float


class DatasetNumericNormalizer:
    def __init__(self, stats: Dict[str, NumericStats]):
        self.stats = stats

    @classmethod
    def fit(cls, dataset: List[Dict[str, Any]], mode: str) -> "DatasetNumericNormalizer":
        profile = get_profile(mode)
        buckets: Dict[str, List[float]] = {}

        for country_doc in dataset:
            cls._collect_from_obj(country_doc, profile, (), buckets)

        stats: Dict[str, NumericStats] = {}
        for field_name, values in buckets.items():
            if not values:
                continue
            stats[field_name] = NumericStats(field_name, min(values), max(values))

        return cls(stats)

    @classmethod
    def _collect_from_obj(
        cls,
        obj: Any,
        profile: PreprocessProfile,
        path: Tuple[str, ...],
        buckets: Dict[str, List[float]],
    ) -> None:
        obj = maybe_normalize_schema(obj, path, profile)

        if isinstance(obj, dict):
            for raw_key, raw_value in obj.items():
                key = canonicalize_key(raw_key)
                cls._collect_from_obj(raw_value, profile, path + (key,), buckets)
            return

        if isinstance(obj, list):
            for item in obj:
                cls._collect_from_obj(item, profile, path + ("item",), buckets)
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

        if field_name in LOG_MINMAX_FIELDS:
            min_v = max(stats.min_value, 0.0)
            max_v = max(stats.max_value, 0.0)
            log_min = math.log1p(min_v)
            log_max = math.log1p(max_v)
            if math.isclose(log_min, log_max):
                return 0.0
            return (math.log1p(max(raw_number, 0.0)) - log_min) / (log_max - log_min)

        if math.isclose(stats.min_value, stats.max_value):
            return 0.0

        return (raw_number - stats.min_value) / (stats.max_value - stats.min_value)


# ============================================================
# Leaf typing
# ============================================================

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


# ============================================================
# Normalized document representation
# ============================================================

def normalize_document(
    obj: Any,
    profile: PreprocessProfile,
    numeric_normalizer: DatasetNumericNormalizer,
    path: Tuple[str, ...] = (),
) -> Any:
    obj = maybe_normalize_schema(obj, path, profile)

    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for raw_key, raw_value in obj.items():
            key = canonicalize_key(raw_key)
            child_path = path + (key,)
            value = normalize_document(raw_value, profile, numeric_normalizer, child_path)
            if key in out:
                out[key] = merge_values(out[key], value)
            else:
                out[key] = value
        return out

    if isinstance(obj, list):
        return [normalize_document(x, profile, numeric_normalizer, path + ("item",)) for x in obj]

    raw_text = scalar_to_raw_text(obj)
    info = detect_numeric_field(path, raw_text) if profile.normalize_numbers else None

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

    if is_url_like(raw_text) or is_code_like(path, raw_text):
        return {
            "__leaf__": True,
            "kind": "atomic_text",
            "raw": raw_text,
            "norm": compare_text(raw_text),
        }

    return {
        "__leaf__": True,
        "kind": "token_text",
        "raw": raw_text,
        "tokens": tokenize_text(raw_text),
    }


# ============================================================
# Tree building
# ============================================================

def build_subtree(label: str, value: Any, top_section: Optional[str] = None) -> TreeNode:
    current_top_section = top_section
    if label in {"General", "Government", "Area", "Population", "Economy", "Demographics", "Administrative details"}:
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
            )

        if kind == "atomic_text":
            return TreeNode(
                label=label,
                raw_value=value["raw"],
                norm_value=value["norm"],
                kind="atomic_text",
                top_section=current_top_section,
            )

        if kind == "token_text":
            parent = TreeNode(
                label=label,
                raw_value=value["raw"],
                kind="token_text_container",
                top_section=current_top_section,
            )
            text_node = TreeNode(label="#text", kind="internal", top_section=current_top_section)
            tokens = value["tokens"]

            if not tokens:
                text_node.children.append(TreeNode(label="<empty>", kind="token", top_section=current_top_section))
            else:
                for token in tokens:
                    text_node.children.append(TreeNode(label=token, kind="token", top_section=current_top_section))

            parent.children.append(text_node)
            return parent

    if isinstance(value, dict):
        node = TreeNode(label=label, kind="internal", top_section=current_top_section)
        for k, v in value.items():
            node.children.append(build_subtree(k, v, current_top_section))
        return node

    if isinstance(value, list):
        node = TreeNode(label=label, kind="internal", top_section=current_top_section)
        for item in value:
            node.children.append(build_subtree("item", item, current_top_section))
        return node

    raw_text = scalar_to_raw_text(value)
    return TreeNode(
        label=label,
        raw_value=raw_text,
        norm_value=compare_text(raw_text),
        kind="atomic_text",
        top_section=current_top_section,
    )


def build_tree_from_country_json(
    country_doc: Dict[str, Any],
    mode: str,
    numeric_normalizer: DatasetNumericNormalizer,
) -> TreeNode:
    profile = get_profile(mode)
    normalized = normalize_document(country_doc, profile, numeric_normalizer)

    root = TreeNode(label="country_document", kind="internal", top_section=None)
    for k, v in normalized.items():
        root.children.append(build_subtree(k, v, None))
    return root


# ============================================================
# TED helpers
# ============================================================

def extract_tokens(node: TreeNode) -> List[str]:
    tokens: List[str] = []
    if not node.children:
        return tokens

    for child in node.children:
        if child.label == "#text":
            for tok in child.children:
                tokens.append(tok.label)
    return tokens


# ============================================================
# TED primitives
# ============================================================

def same_label(a: TreeNode, b: TreeNode) -> bool:
    return compare_text(a.label) == compare_text(b.label)


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
            return 1.0
        return abs(a.norm_number - b.norm_number)

    if a.kind == "atomic_text" and b.kind == "atomic_text":
        return 0.0 if compare_text(a.norm_value) == compare_text(b.norm_value) else 1.0

    if a.kind == "token" and b.kind == "token":
        return 0.0

    return 1.0


def cost_upd(a: TreeNode, b: TreeNode) -> float:
    label_cost = 0.0 if same_label(a, b) else 1.0
    value_cost = value_update_cost(a, b)
    return label_cost + value_cost


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


def cost_ins_tree(subtree: TreeNode, source_tree: TreeNode, contain_memo: Dict[Tuple[int, int], bool]) -> float:
    if contained_anywhere(subtree, source_tree, contain_memo):
        return 1.0
    return float(subtree_size(subtree))


def cost_del_tree(subtree: TreeNode, dest_tree: TreeNode, contain_memo: Dict[Tuple[int, int], bool]) -> float:
    if contained_anywhere(subtree, dest_tree, contain_memo):
        return 1.0
    return float(subtree_size(subtree))


# ============================================================
# Nierman & Jagadish-style TED
# ============================================================

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
    max_cost = float(subtree_size(a) + subtree_size(b))
    if math.isclose(max_cost, 0.0):
        return 1.0
    return max(0.0, 1.0 - (dist / max_cost))


# ============================================================
# Edit script recovery
# ============================================================

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


# ============================================================
# Tree patching (4.4) and post-processing (4.5)
# ============================================================

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


# ============================================================
# Dataset helpers / compare
# ============================================================

def load_dataset(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "countries" in data:
        return data["countries"]

    if isinstance(data, list):
        return data

    raise ValueError("Unsupported dataset format. Expected a list or a dict with a 'countries' key.")


def get_country_doc(dataset: List[Dict[str, Any]], country_name: str) -> Dict[str, Any]:
    wanted = country_name.casefold().strip()
    for item in dataset:
        if str(item.get("country", "")).casefold().strip() == wanted:
            return item
    raise KeyError(f"Country not found: {country_name}")


def compare_countries(dataset_path: str, country_a: str, country_b: str, mode: str) -> Dict[str, Any]:
    dataset = load_dataset(dataset_path)
    numeric_normalizer = DatasetNumericNormalizer.fit(dataset, mode)

    doc_a = get_country_doc(dataset, country_a)
    doc_b = get_country_doc(dataset, country_b)

    tree_a = build_tree_from_country_json(doc_a, mode, numeric_normalizer)
    tree_b = build_tree_from_country_json(doc_b, mode, numeric_normalizer)
    _assign_patch_ids(tree_a)

    memo: Dict[Tuple[int, int], float] = {}
    contain_memo: Dict[Tuple[int, int], bool] = {}

    distance = nj_ted_cost(tree_a, tree_b, memo, contain_memo)
    similarity = normalized_similarity(tree_a, tree_b)
    script = recover_edit_script(tree_a, tree_b, "root", memo, contain_memo)

    return {
        "mode": mode,
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


# ============================================================
# CLI
# ============================================================

def default_dataset_for_mode(base_dir: Path, mode: str) -> Path:
    if mode == "clean":
        return base_dir / "all_countries_clean_final.json"
    return base_dir / "all_countries.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Nierman & Jagadish-style TED for country infobox JSON")
    parser.add_argument("--mode", choices=["raw", "clean"], required=True)
    parser.add_argument("--dataset", default=None, help="Optional custom dataset path")
    parser.add_argument("--a", required=True, help="Source country")
    parser.add_argument("--b", required=True, help="Target country")
    parser.add_argument("--ops", type=int, default=20, help="How many edit operations to print")
    parser.add_argument("--show-tree", choices=["none", "raw", "norm", "number"], default="none")
    parser.add_argument("--out-dir", default="outputs", help="Directory used to save diff, patched JSON, and post-processed text")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    dataset_path = Path(args.dataset) if args.dataset else default_dataset_for_mode(base_dir, args.mode)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = compare_countries(
        dataset_path=str(dataset_path),
        country_a=args.a,
        country_b=args.b,
        mode=args.mode,
    )

    patched_tree = apply_edit_script_to_tree(result["tree_a"], result["edit_script"])
    verification = verify_patch(patched_tree, result["tree_b"])

    a_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", args.a.strip())
    b_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", args.b.strip())

    edit_script_path = out_dir / f"edit_script_{a_safe}_to_{b_safe}.json"
    with open(edit_script_path, "w", encoding="utf-8") as f:
        json.dump(result["edit_script"], f, ensure_ascii=False, indent=2)

    patched_json_path = out_dir / f"patched_{a_safe}_to_{b_safe}.json"
    save_tree_as_json(patched_tree, str(patched_json_path), prefer="raw")

    patched_text_path = out_dir / f"patched_{a_safe}_to_{b_safe}_infobox.txt"
    with open(patched_text_path, "w", encoding="utf-8") as f:
        f.write(tree_to_infobox_text(patched_tree, prefer="raw"))

    target_json_path = out_dir / f"target_{b_safe}.json"
    save_tree_as_json(result["tree_b"], str(target_json_path), prefer="raw")

    print(f"Dataset: {dataset_path}")
    print(f"Mode: {result['mode']}")
    print(f"Source country (A): {result['country_a']}")
    print(f"Target country (B): {result['country_b']}")
    print(f"Distance: {result['distance']:.6f}")
    print(f"Similarity: {result['similarity']:.6f}")
    print(f"Tree A size: {result['tree_a_size']}")
    print(f"Tree B size: {result['tree_b_size']}")

    print("\nPatch verification:")
    print(json.dumps(verification, ensure_ascii=False, indent=2))

    print("\nSaved files:")
    print(f"  Edit script:   {edit_script_path}")
    print(f"  Patched JSON:  {patched_json_path}")
    print(f"  Patched text:  {patched_text_path}")
    print(f"  Target JSON:   {target_json_path}")

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


if __name__ == "__main__":
    main()
