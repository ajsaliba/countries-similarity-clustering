#!/usr/bin/env python3
"""Fetch selected country metrics for UN-recognized countries and write one JSON per country.

Outputs:
- out_dir/<slug>.json   e.g. lebanon.json
- out_dir/all_countries.json

Optional:
- Merge internet speed metrics from a CSV file with columns:
  iso3,fixed_download_mbps,mobile_download_mbps
  or
  country_iso3,fixed_download_mbps,mobile_download_mbps
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

import requests

WB_BASE = "https://api.worldbank.org/v2"
TIMEOUT = 60

# 193 UN member states + 2 observer states with country status at the UN.
UN_COUNTRIES = [
    {"iso3": "AFG", "name": "Afghanistan"},
    {"iso3": "ALB", "name": "Albania"},
    {"iso3": "DZA", "name": "Algeria"},
    {"iso3": "AND", "name": "Andorra"},
    {"iso3": "AGO", "name": "Angola"},
    {"iso3": "ATG", "name": "Antigua and Barbuda"},
    {"iso3": "ARG", "name": "Argentina"},
    {"iso3": "ARM", "name": "Armenia"},
    {"iso3": "AUS", "name": "Australia"},
    {"iso3": "AUT", "name": "Austria"},
    {"iso3": "AZE", "name": "Azerbaijan"},
    {"iso3": "BHS", "name": "Bahamas"},
    {"iso3": "BHR", "name": "Bahrain"},
    {"iso3": "BGD", "name": "Bangladesh"},
    {"iso3": "BRB", "name": "Barbados"},
    {"iso3": "BLR", "name": "Belarus"},
    {"iso3": "BEL", "name": "Belgium"},
    {"iso3": "BLZ", "name": "Belize"},
    {"iso3": "BEN", "name": "Benin"},
    {"iso3": "BTN", "name": "Bhutan"},
    {"iso3": "BOL", "name": "Bolivia"},
    {"iso3": "BIH", "name": "Bosnia and Herzegovina"},
    {"iso3": "BWA", "name": "Botswana"},
    {"iso3": "BRA", "name": "Brazil"},
    {"iso3": "BRN", "name": "Brunei Darussalam"},
    {"iso3": "BGR", "name": "Bulgaria"},
    {"iso3": "BFA", "name": "Burkina Faso"},
    {"iso3": "BDI", "name": "Burundi"},
    {"iso3": "CPV", "name": "Cabo Verde"},
    {"iso3": "KHM", "name": "Cambodia"},
    {"iso3": "CMR", "name": "Cameroon"},
    {"iso3": "CAN", "name": "Canada"},
    {"iso3": "CAF", "name": "Central African Republic"},
    {"iso3": "TCD", "name": "Chad"},
    {"iso3": "CHL", "name": "Chile"},
    {"iso3": "CHN", "name": "China"},
    {"iso3": "COL", "name": "Colombia"},
    {"iso3": "COM", "name": "Comoros"},
    {"iso3": "COG", "name": "Congo"},
    {"iso3": "CRI", "name": "Costa Rica"},
    {"iso3": "CIV", "name": "Cote d'Ivoire"},
    {"iso3": "HRV", "name": "Croatia"},
    {"iso3": "CUB", "name": "Cuba"},
    {"iso3": "CYP", "name": "Cyprus"},
    {"iso3": "CZE", "name": "Czechia"},
    {"iso3": "PRK", "name": "Democratic People's Republic of Korea"},
    {"iso3": "COD", "name": "Democratic Republic of the Congo"},
    {"iso3": "DNK", "name": "Denmark"},
    {"iso3": "DJI", "name": "Djibouti"},
    {"iso3": "DMA", "name": "Dominica"},
    {"iso3": "DOM", "name": "Dominican Republic"},
    {"iso3": "ECU", "name": "Ecuador"},
    {"iso3": "EGY", "name": "Egypt"},
    {"iso3": "SLV", "name": "El Salvador"},
    {"iso3": "GNQ", "name": "Equatorial Guinea"},
    {"iso3": "ERI", "name": "Eritrea"},
    {"iso3": "EST", "name": "Estonia"},
    {"iso3": "SWZ", "name": "Eswatini"},
    {"iso3": "ETH", "name": "Ethiopia"},
    {"iso3": "FJI", "name": "Fiji"},
    {"iso3": "FIN", "name": "Finland"},
    {"iso3": "FRA", "name": "France"},
    {"iso3": "GAB", "name": "Gabon"},
    {"iso3": "GMB", "name": "Gambia"},
    {"iso3": "GEO", "name": "Georgia"},
    {"iso3": "DEU", "name": "Germany"},
    {"iso3": "GHA", "name": "Ghana"},
    {"iso3": "GRC", "name": "Greece"},
    {"iso3": "GRD", "name": "Grenada"},
    {"iso3": "GTM", "name": "Guatemala"},
    {"iso3": "GIN", "name": "Guinea"},
    {"iso3": "GNB", "name": "Guinea-Bissau"},
    {"iso3": "GUY", "name": "Guyana"},
    {"iso3": "HTI", "name": "Haiti"},
    {"iso3": "HND", "name": "Honduras"},
    {"iso3": "HUN", "name": "Hungary"},
    {"iso3": "ISL", "name": "Iceland"},
    {"iso3": "IND", "name": "India"},
    {"iso3": "IDN", "name": "Indonesia"},
    {"iso3": "IRN", "name": "Iran"},
    {"iso3": "IRQ", "name": "Iraq"},
    {"iso3": "IRL", "name": "Ireland"},
    {"iso3": "ISR", "name": "Israel"},
    {"iso3": "ITA", "name": "Italy"},
    {"iso3": "JAM", "name": "Jamaica"},
    {"iso3": "JPN", "name": "Japan"},
    {"iso3": "JOR", "name": "Jordan"},
    {"iso3": "KAZ", "name": "Kazakhstan"},
    {"iso3": "KEN", "name": "Kenya"},
    {"iso3": "KIR", "name": "Kiribati"},
    {"iso3": "KWT", "name": "Kuwait"},
    {"iso3": "KGZ", "name": "Kyrgyzstan"},
    {"iso3": "LAO", "name": "Lao People's Democratic Republic"},
    {"iso3": "LVA", "name": "Latvia"},
    {"iso3": "LBN", "name": "Lebanon"},
    {"iso3": "LSO", "name": "Lesotho"},
    {"iso3": "LBR", "name": "Liberia"},
    {"iso3": "LBY", "name": "Libya"},
    {"iso3": "LIE", "name": "Liechtenstein"},
    {"iso3": "LTU", "name": "Lithuania"},
    {"iso3": "LUX", "name": "Luxembourg"},
    {"iso3": "MDG", "name": "Madagascar"},
    {"iso3": "MWI", "name": "Malawi"},
    {"iso3": "MYS", "name": "Malaysia"},
    {"iso3": "MDV", "name": "Maldives"},
    {"iso3": "MLI", "name": "Mali"},
    {"iso3": "MLT", "name": "Malta"},
    {"iso3": "MHL", "name": "Marshall Islands"},
    {"iso3": "MRT", "name": "Mauritania"},
    {"iso3": "MUS", "name": "Mauritius"},
    {"iso3": "MEX", "name": "Mexico"},
    {"iso3": "FSM", "name": "Micronesia"},
    {"iso3": "MDA", "name": "Moldova"},
    {"iso3": "MCO", "name": "Monaco"},
    {"iso3": "MNG", "name": "Mongolia"},
    {"iso3": "MNE", "name": "Montenegro"},
    {"iso3": "MAR", "name": "Morocco"},
    {"iso3": "MOZ", "name": "Mozambique"},
    {"iso3": "MMR", "name": "Myanmar"},
    {"iso3": "NAM", "name": "Namibia"},
    {"iso3": "NRU", "name": "Nauru"},
    {"iso3": "NPL", "name": "Nepal"},
    {"iso3": "NLD", "name": "Netherlands"},
    {"iso3": "NZL", "name": "New Zealand"},
    {"iso3": "NIC", "name": "Nicaragua"},
    {"iso3": "NER", "name": "Niger"},
    {"iso3": "NGA", "name": "Nigeria"},
    {"iso3": "MKD", "name": "North Macedonia"},
    {"iso3": "NOR", "name": "Norway"},
    {"iso3": "OMN", "name": "Oman"},
    {"iso3": "PAK", "name": "Pakistan"},
    {"iso3": "PLW", "name": "Palau"},
    {"iso3": "PAN", "name": "Panama"},
    {"iso3": "PNG", "name": "Papua New Guinea"},
    {"iso3": "PRY", "name": "Paraguay"},
    {"iso3": "PER", "name": "Peru"},
    {"iso3": "PHL", "name": "Philippines"},
    {"iso3": "POL", "name": "Poland"},
    {"iso3": "PRT", "name": "Portugal"},
    {"iso3": "QAT", "name": "Qatar"},
    {"iso3": "KOR", "name": "Republic of Korea"},
    {"iso3": "ROU", "name": "Romania"},
    {"iso3": "RUS", "name": "Russian Federation"},
    {"iso3": "RWA", "name": "Rwanda"},
    {"iso3": "KNA", "name": "Saint Kitts and Nevis"},
    {"iso3": "LCA", "name": "Saint Lucia"},
    {"iso3": "VCT", "name": "Saint Vincent and the Grenadines"},
    {"iso3": "WSM", "name": "Samoa"},
    {"iso3": "SMR", "name": "San Marino"},
    {"iso3": "STP", "name": "Sao Tome and Principe"},
    {"iso3": "SAU", "name": "Saudi Arabia"},
    {"iso3": "SEN", "name": "Senegal"},
    {"iso3": "SRB", "name": "Serbia"},
    {"iso3": "SYC", "name": "Seychelles"},
    {"iso3": "SLE", "name": "Sierra Leone"},
    {"iso3": "SGP", "name": "Singapore"},
    {"iso3": "SVK", "name": "Slovakia"},
    {"iso3": "SVN", "name": "Slovenia"},
    {"iso3": "SLB", "name": "Solomon Islands"},
    {"iso3": "SOM", "name": "Somalia"},
    {"iso3": "ZAF", "name": "South Africa"},
    {"iso3": "SSD", "name": "South Sudan"},
    {"iso3": "ESP", "name": "Spain"},
    {"iso3": "LKA", "name": "Sri Lanka"},
    {"iso3": "SDN", "name": "Sudan"},
    {"iso3": "SUR", "name": "Suriname"},
    {"iso3": "SWE", "name": "Sweden"},
    {"iso3": "CHE", "name": "Switzerland"},
    {"iso3": "SYR", "name": "Syrian Arab Republic"},
    {"iso3": "TJK", "name": "Tajikistan"},
    {"iso3": "THA", "name": "Thailand"},
    {"iso3": "TLS", "name": "Timor-Leste"},
    {"iso3": "TGO", "name": "Togo"},
    {"iso3": "TON", "name": "Tonga"},
    {"iso3": "TTO", "name": "Trinidad and Tobago"},
    {"iso3": "TUN", "name": "Tunisia"},
    {"iso3": "TUR", "name": "Turkiye"},
    {"iso3": "TKM", "name": "Turkmenistan"},
    {"iso3": "TUV", "name": "Tuvalu"},
    {"iso3": "UGA", "name": "Uganda"},
    {"iso3": "UKR", "name": "Ukraine"},
    {"iso3": "ARE", "name": "United Arab Emirates"},
    {"iso3": "GBR", "name": "United Kingdom"},
    {"iso3": "USA", "name": "United States of America"},
    {"iso3": "TZA", "name": "United Republic of Tanzania"},
    {"iso3": "URY", "name": "Uruguay"},
    {"iso3": "UZB", "name": "Uzbekistan"},
    {"iso3": "VUT", "name": "Vanuatu"},
    {"iso3": "VEN", "name": "Venezuela"},
    {"iso3": "VNM", "name": "Viet Nam"},
    {"iso3": "YEM", "name": "Yemen"},
    {"iso3": "ZMB", "name": "Zambia"},
    {"iso3": "ZWE", "name": "Zimbabwe"},
    {"iso3": "PSE", "name": "State of Palestine"},
    {"iso3": "VAT", "name": "Holy See"},
]

FINAL_STAGE1_METRICS = {
    "access_to_electricity_percent": "EG.ELC.ACCS.ZS",
    "basic_drinking_water_percent": "SH.H2O.BASW.ZS",
    "basic_sanitation_percent": "SH.STA.BASS.ZS",
    "internet_users_percent": "IT.NET.USER.ZS",
    "fixed_broadband_subscriptions_per_100": "IT.NET.BBND.P2",
    "transport_infrastructure_quality_lpi": "LP.LPI.INFR.XQ",
    "government_effectiveness": "GE.EST",
    "rule_of_law": "RL.EST",
    "control_of_corruption": "CC.EST",
    "political_stability": "PV.EST",
    "regulatory_quality": "RQ.EST",
    "gdp_per_capita_ppp": "NY.GDP.PCAP.PP.CD",
    "unemployment_percent": "SL.UEM.TOTL.ZS",
    "inflation_percent": "FP.CPI.TOTL.ZG",
    "agriculture_value_added_percent_gdp": "NV.AGR.TOTL.ZS",
    "industry_value_added_percent_gdp": "NV.IND.TOTL.ZS",
    "services_value_added_percent_gdp": "NV.SRV.TOTL.ZS",
    "trade_percent_gdp": "NE.TRD.GNFS.ZS",
    "exports_percent_gdp": "NE.EXP.GNFS.ZS",
    "imports_percent_gdp": "NE.IMP.GNFS.ZS",
    "domestic_credit_private_sector_percent_gdp": "FS.AST.PRVT.GD.ZS",
    "secondary_school_enrollment_gross": "SE.SEC.ENRR",
    "tertiary_school_enrollment_gross": "SE.TER.ENRR",
    "central_government_debt_percent_gdp": "GC.DOD.TOTL.GD.ZS",
    "external_debt_percent_gni": "DT.DOD.DECT.GN.ZS",
    "debt_service_percent_exports": "DT.TDS.DECT.EX.ZS",
    "intentional_homicides_per_100k": "VC.IHR.PSRC.P5",
    "life_expectancy_years": "SP.DYN.LE00.IN",
    "under_5_mortality_per_1000": "SH.DYN.MORT",
    "current_health_expenditure_percent_gdp": "SH.XPD.CHEX.GD.ZS",
    "physicians_per_1000_people": "SH.MED.PHYS.ZS",
}


def slugify(name: str) -> str:
    name = name.lower().strip()
    name = name.replace("&", " and ")
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return re.sub(r"_+", "_", name).strip("_")


def wb_get_json(url: str, params: Dict[str, Any] | None = None) -> Any:
    response = requests.get(url, params=params or {}, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def fetch_world_bank_indicator(code: str) -> Dict[str, Dict[str, Any]]:
    """Return latest non-null value per ISO3 country for an indicator.

    Output format:
      {"LBN": {"value": 99.8, "year": 2023, "wb_country_name": "Lebanon"}, ...}
    """
    url = f"{WB_BASE}/country/all/indicator/{code}"
    params = {
        "format": "json",
        "per_page": 20000,
        "mrv": 10,
    }
    payload = wb_get_json(url, params=params)
    if not isinstance(payload, list) or len(payload) < 2:
        raise RuntimeError(f"Unexpected World Bank API response for {code}: {payload!r}")

    rows = payload[1] or []
    latest: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        country = row.get("country") or {}
        iso3 = row.get("countryiso3code") or country.get("id") or ""
        if not iso3 or iso3 == "":
            continue
        if row.get("value") is None:
            continue
        year_raw = row.get("date")
        try:
            year = int(year_raw) if year_raw else None
        except ValueError:
            year = None
        prev = latest.get(iso3)
        if prev is None or (year is not None and (prev.get("year") is None or year > prev["year"])):
            latest[iso3] = {
                "value": row.get("value"),
                "year": year,
                "wb_country_name": country.get("value"),
            }
    return latest


def load_speed_csv(path: Path) -> Dict[str, Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            iso3 = (row.get("iso3") or row.get("country_iso3") or "").strip().upper()
            if not iso3:
                continue
            merged[iso3] = {
                "fixed_download_speed_mbps": to_float(row.get("fixed_download_mbps")),
                "mobile_download_speed_mbps": to_float(row.get("mobile_download_mbps")),
            }
    return merged


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def build_country_records(speed_csv: Path | None = None) -> list[dict[str, Any]]:
    un_by_iso3 = {item["iso3"]: item["name"] for item in UN_COUNTRIES}

    wb_data_by_metric: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for metric_name, code in FINAL_STAGE1_METRICS.items():
        if code is None:
            continue
        print(f"Fetching {metric_name} ({code})...", file=sys.stderr)
        wb_data_by_metric[metric_name] = fetch_world_bank_indicator(code)

    speed_data: Dict[str, Dict[str, Any]] = {}
    if speed_csv:
        speed_data = load_speed_csv(speed_csv)

    records: list[dict[str, Any]] = []
    for iso3, un_name in un_by_iso3.items():
        country_obj: dict[str, Any] = {
            "country": un_name,
            "iso3": iso3,
            "metrics": {},
        }
        wb_names_seen = set()
        for metric_name, code in FINAL_STAGE1_METRICS.items():
            if code is None:
                value = speed_data.get(iso3, {}).get(metric_name)
                country_obj["metrics"][metric_name] = {
                    "value": value,
                    "year": None,
                    "source": "external_speed_csv" if value is not None else None,
                }
                continue

            entry = wb_data_by_metric.get(metric_name, {}).get(iso3)
            if entry:
                wb_names_seen.add(entry.get("wb_country_name"))
                country_obj["metrics"][metric_name] = {
                    "value": entry.get("value"),
                    "year": entry.get("year"),
                    "source": "world_bank",
                    "indicator_code": code,
                }
            else:
                country_obj["metrics"][metric_name] = {
                    "value": None,
                    "year": None,
                    "source": "world_bank",
                    "indicator_code": code,
                }

        country_obj["world_bank_country_name"] = sorted(name for name in wb_names_seen if name)[:1] or None
        records.append(country_obj)

    return records


def write_outputs(records: Iterable[dict[str, Any]], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    records_list = list(records)

    for record in records_list:
        filename = f"{slugify(record['country'])}.json"
        path = out_dir / filename
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    all_path = out_dir / "all_countries.json"
    all_path.write_text(json.dumps(records_list, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Stage 1 metrics for UN-recognized countries.")
    parser.add_argument(
        "--out-dir",
        default="../Data/JSON",
        help="Directory where per-country JSON files will be written.",
    )
    parser.add_argument(
        "--speed-csv",
        default=None,
        help="Optional CSV with columns iso3/country_iso3, fixed_download_mbps, mobile_download_mbps.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    speed_csv = Path(args.speed_csv) if args.speed_csv else None
    if speed_csv and not speed_csv.exists():
        print(f"Speed CSV not found: {speed_csv}", file=sys.stderr)
        return 2

    records = build_country_records(speed_csv=speed_csv)
    write_outputs(records, Path(args.out_dir))
    print(f"Wrote {len(records)} country JSON files to {args.out_dir}")
    print(f"Example: {Path(args.out_dir) / 'lebanon.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
