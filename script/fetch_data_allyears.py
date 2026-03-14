import os
import re
import json
import time
import argparse
from typing import Dict, List, Any, Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import requests


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
    "secondary_school_enrollment_gross": "SE.SEC.ENRR",
    "tertiary_school_enrollment_gross": "SE.TER.ENRR",
    "central_government_debt_percent_gdp": "GC.DOD.TOTL.GD.ZS",
    "external_debt_percent_gni": "DT.DOD.DECT.GN.ZS",
    "debt_service_percent_exports": "DT.TDS.DECT.EX.ZS",
    "domestic_credit_private_sector_percent_gdp": "FS.AST.PRVT.GD.ZS",
    "intentional_homicides_per_100k": "VC.IHR.PSRC.P5",
    "life_expectancy_years": "SP.DYN.LE00.IN",
    "under_5_mortality_per_1000": "SH.DYN.MORT",
    "current_health_expenditure_percent_gdp": "SH.XPD.CHEX.GD.ZS",
    "physicians_per_1000_people": "SH.MED.PHYS.ZS",
    "agriculture_value_added_percent_gdp": "NV.AGR.TOTL.ZS",
    "industry_value_added_percent_gdp": "NV.IND.TOTL.ZS",
    "services_value_added_percent_gdp": "NV.SRV.TOTL.ZS",
    "trade_percent_gdp": "NE.TRD.GNFS.ZS",
    "exports_percent_gdp": "NE.EXP.GNFS.ZS",
    "imports_percent_gdp": "NE.IMP.GNFS.ZS",
}


UN_RECOGNIZED_COUNTRIES = [
    {"name": "Afghanistan", "iso3": "AFG"},
    {"name": "Albania", "iso3": "ALB"},
    {"name": "Algeria", "iso3": "DZA"},
    {"name": "Andorra", "iso3": "AND"},
    {"name": "Angola", "iso3": "AGO"},
    {"name": "Antigua and Barbuda", "iso3": "ATG"},
    {"name": "Argentina", "iso3": "ARG"},
    {"name": "Armenia", "iso3": "ARM"},
    {"name": "Australia", "iso3": "AUS"},
    {"name": "Austria", "iso3": "AUT"},
    {"name": "Azerbaijan", "iso3": "AZE"},
    {"name": "Bahamas", "iso3": "BHS"},
    {"name": "Bahrain", "iso3": "BHR"},
    {"name": "Bangladesh", "iso3": "BGD"},
    {"name": "Barbados", "iso3": "BRB"},
    {"name": "Belarus", "iso3": "BLR"},
    {"name": "Belgium", "iso3": "BEL"},
    {"name": "Belize", "iso3": "BLZ"},
    {"name": "Benin", "iso3": "BEN"},
    {"name": "Bhutan", "iso3": "BTN"},
    {"name": "Bolivia", "iso3": "BOL"},
    {"name": "Bosnia and Herzegovina", "iso3": "BIH"},
    {"name": "Botswana", "iso3": "BWA"},
    {"name": "Brazil", "iso3": "BRA"},
    {"name": "Brunei Darussalam", "iso3": "BRN"},
    {"name": "Bulgaria", "iso3": "BGR"},
    {"name": "Burkina Faso", "iso3": "BFA"},
    {"name": "Burundi", "iso3": "BDI"},
    {"name": "Cabo Verde", "iso3": "CPV"},
    {"name": "Cambodia", "iso3": "KHM"},
    {"name": "Cameroon", "iso3": "CMR"},
    {"name": "Canada", "iso3": "CAN"},
    {"name": "Central African Republic", "iso3": "CAF"},
    {"name": "Chad", "iso3": "TCD"},
    {"name": "Chile", "iso3": "CHL"},
    {"name": "China", "iso3": "CHN"},
    {"name": "Colombia", "iso3": "COL"},
    {"name": "Comoros", "iso3": "COM"},
    {"name": "Congo", "iso3": "COG"},
    {"name": "Costa Rica", "iso3": "CRI"},
    {"name": "Croatia", "iso3": "HRV"},
    {"name": "Cuba", "iso3": "CUB"},
    {"name": "Cyprus", "iso3": "CYP"},
    {"name": "Czechia", "iso3": "CZE"},
    {"name": "Democratic People's Republic of Korea", "iso3": "PRK"},
    {"name": "Democratic Republic of the Congo", "iso3": "COD"},
    {"name": "Denmark", "iso3": "DNK"},
    {"name": "Djibouti", "iso3": "DJI"},
    {"name": "Dominica", "iso3": "DMA"},
    {"name": "Dominican Republic", "iso3": "DOM"},
    {"name": "Ecuador", "iso3": "ECU"},
    {"name": "Egypt", "iso3": "EGY"},
    {"name": "El Salvador", "iso3": "SLV"},
    {"name": "Equatorial Guinea", "iso3": "GNQ"},
    {"name": "Eritrea", "iso3": "ERI"},
    {"name": "Estonia", "iso3": "EST"},
    {"name": "Eswatini", "iso3": "SWZ"},
    {"name": "Ethiopia", "iso3": "ETH"},
    {"name": "Fiji", "iso3": "FJI"},
    {"name": "Finland", "iso3": "FIN"},
    {"name": "France", "iso3": "FRA"},
    {"name": "Gabon", "iso3": "GAB"},
    {"name": "Gambia", "iso3": "GMB"},
    {"name": "Georgia", "iso3": "GEO"},
    {"name": "Germany", "iso3": "DEU"},
    {"name": "Ghana", "iso3": "GHA"},
    {"name": "Greece", "iso3": "GRC"},
    {"name": "Grenada", "iso3": "GRD"},
    {"name": "Guatemala", "iso3": "GTM"},
    {"name": "Guinea", "iso3": "GIN"},
    {"name": "Guinea-Bissau", "iso3": "GNB"},
    {"name": "Guyana", "iso3": "GUY"},
    {"name": "Haiti", "iso3": "HTI"},
    {"name": "Honduras", "iso3": "HND"},
    {"name": "Hungary", "iso3": "HUN"},
    {"name": "Iceland", "iso3": "ISL"},
    {"name": "India", "iso3": "IND"},
    {"name": "Indonesia", "iso3": "IDN"},
    {"name": "Iran", "iso3": "IRN"},
    {"name": "Iraq", "iso3": "IRQ"},
    {"name": "Ireland", "iso3": "IRL"},
    {"name": "Israel", "iso3": "ISR"},
    {"name": "Italy", "iso3": "ITA"},
    {"name": "Jamaica", "iso3": "JAM"},
    {"name": "Japan", "iso3": "JPN"},
    {"name": "Jordan", "iso3": "JOR"},
    {"name": "Kazakhstan", "iso3": "KAZ"},
    {"name": "Kenya", "iso3": "KEN"},
    {"name": "Kiribati", "iso3": "KIR"},
    {"name": "Kuwait", "iso3": "KWT"},
    {"name": "Kyrgyzstan", "iso3": "KGZ"},
    {"name": "Lao People's Democratic Republic", "iso3": "LAO"},
    {"name": "Latvia", "iso3": "LVA"},
    {"name": "Lebanon", "iso3": "LBN"},
    {"name": "Lesotho", "iso3": "LSO"},
    {"name": "Liberia", "iso3": "LBR"},
    {"name": "Libya", "iso3": "LBY"},
    {"name": "Liechtenstein", "iso3": "LIE"},
    {"name": "Lithuania", "iso3": "LTU"},
    {"name": "Luxembourg", "iso3": "LUX"},
    {"name": "Madagascar", "iso3": "MDG"},
    {"name": "Malawi", "iso3": "MWI"},
    {"name": "Malaysia", "iso3": "MYS"},
    {"name": "Maldives", "iso3": "MDV"},
    {"name": "Mali", "iso3": "MLI"},
    {"name": "Malta", "iso3": "MLT"},
    {"name": "Marshall Islands", "iso3": "MHL"},
    {"name": "Mauritania", "iso3": "MRT"},
    {"name": "Mauritius", "iso3": "MUS"},
    {"name": "Mexico", "iso3": "MEX"},
    {"name": "Micronesia", "iso3": "FSM"},
    {"name": "Monaco", "iso3": "MCO"},
    {"name": "Mongolia", "iso3": "MNG"},
    {"name": "Montenegro", "iso3": "MNE"},
    {"name": "Morocco", "iso3": "MAR"},
    {"name": "Mozambique", "iso3": "MOZ"},
    {"name": "Myanmar", "iso3": "MMR"},
    {"name": "Namibia", "iso3": "NAM"},
    {"name": "Nauru", "iso3": "NRU"},
    {"name": "Nepal", "iso3": "NPL"},
    {"name": "Netherlands", "iso3": "NLD"},
    {"name": "New Zealand", "iso3": "NZL"},
    {"name": "Nicaragua", "iso3": "NIC"},
    {"name": "Niger", "iso3": "NER"},
    {"name": "Nigeria", "iso3": "NGA"},
    {"name": "North Macedonia", "iso3": "MKD"},
    {"name": "Norway", "iso3": "NOR"},
    {"name": "Oman", "iso3": "OMN"},
    {"name": "Pakistan", "iso3": "PAK"},
    {"name": "Palau", "iso3": "PLW"},
    {"name": "Panama", "iso3": "PAN"},
    {"name": "Papua New Guinea", "iso3": "PNG"},
    {"name": "Paraguay", "iso3": "PRY"},
    {"name": "Peru", "iso3": "PER"},
    {"name": "Philippines", "iso3": "PHL"},
    {"name": "Poland", "iso3": "POL"},
    {"name": "Portugal", "iso3": "PRT"},
    {"name": "Qatar", "iso3": "QAT"},
    {"name": "Republic of Korea", "iso3": "KOR"},
    {"name": "Republic of Moldova", "iso3": "MDA"},
    {"name": "Romania", "iso3": "ROU"},
    {"name": "Russian Federation", "iso3": "RUS"},
    {"name": "Rwanda", "iso3": "RWA"},
    {"name": "Saint Kitts and Nevis", "iso3": "KNA"},
    {"name": "Saint Lucia", "iso3": "LCA"},
    {"name": "Saint Vincent and the Grenadines", "iso3": "VCT"},
    {"name": "Samoa", "iso3": "WSM"},
    {"name": "San Marino", "iso3": "SMR"},
    {"name": "Sao Tome and Principe", "iso3": "STP"},
    {"name": "Saudi Arabia", "iso3": "SAU"},
    {"name": "Senegal", "iso3": "SEN"},
    {"name": "Serbia", "iso3": "SRB"},
    {"name": "Seychelles", "iso3": "SYC"},
    {"name": "Sierra Leone", "iso3": "SLE"},
    {"name": "Singapore", "iso3": "SGP"},
    {"name": "Slovakia", "iso3": "SVK"},
    {"name": "Slovenia", "iso3": "SVN"},
    {"name": "Solomon Islands", "iso3": "SLB"},
    {"name": "Somalia", "iso3": "SOM"},
    {"name": "South Africa", "iso3": "ZAF"},
    {"name": "South Sudan", "iso3": "SSD"},
    {"name": "Spain", "iso3": "ESP"},
    {"name": "Sri Lanka", "iso3": "LKA"},
    {"name": "Sudan", "iso3": "SDN"},
    {"name": "Suriname", "iso3": "SUR"},
    {"name": "Sweden", "iso3": "SWE"},
    {"name": "Switzerland", "iso3": "CHE"},
    {"name": "Syrian Arab Republic", "iso3": "SYR"},
    {"name": "Tajikistan", "iso3": "TJK"},
    {"name": "Thailand", "iso3": "THA"},
    {"name": "Timor-Leste", "iso3": "TLS"},
    {"name": "Togo", "iso3": "TGO"},
    {"name": "Tonga", "iso3": "TON"},
    {"name": "Trinidad and Tobago", "iso3": "TTO"},
    {"name": "Tunisia", "iso3": "TUN"},
    {"name": "Türkiye", "iso3": "TUR"},
    {"name": "Turkmenistan", "iso3": "TKM"},
    {"name": "Tuvalu", "iso3": "TUV"},
    {"name": "Uganda", "iso3": "UGA"},
    {"name": "Ukraine", "iso3": "UKR"},
    {"name": "United Arab Emirates", "iso3": "ARE"},
    {"name": "United Kingdom", "iso3": "GBR"},
    {"name": "United Republic of Tanzania", "iso3": "TZA"},
    {"name": "United States of America", "iso3": "USA"},
    {"name": "Uruguay", "iso3": "URY"},
    {"name": "Uzbekistan", "iso3": "UZB"},
    {"name": "Vanuatu", "iso3": "VUT"},
    {"name": "Venezuela", "iso3": "VEN"},
    {"name": "Viet Nam", "iso3": "VNM"},
    {"name": "Yemen", "iso3": "YEM"},
    {"name": "Zambia", "iso3": "ZMB"},
    {"name": "Zimbabwe", "iso3": "ZWE"},
    {"name": "State of Palestine", "iso3": "PSE"},
    {"name": "Holy See", "iso3": "VAT"},
]


def slugify(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[-\s]+", "_", name)
    return name


def safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_indicator_all_years_for_country(iso3: str, indicator_code: str, session: requests.Session) -> List[Dict[str, Any]]:
    per_page = 1000
    page = 1
    results: List[Dict[str, Any]] = []

    while True:
        url = (
            f"https://api.worldbank.org/v2/country/{iso3}/indicator/{indicator_code}"
            f"?format=json&per_page={per_page}&page={page}"
        )

        max_retries = 5
        payload = None

        for attempt in range(max_retries):
            try:
                resp = session.get(url, timeout=30)
                resp.raise_for_status()
                payload = resp.json()
                break
            except requests.exceptions.RequestException as e:
                wait_time = 2 ** attempt
                print(
                    f"  Retry {attempt + 1}/{max_retries} for {iso3} - {indicator_code} - page {page} "
                    f"after error: {e}"
                )
                time.sleep(wait_time)

        if payload is None:
            print(f"  Failed permanently for {iso3} - {indicator_code} - page {page}")
            break

        if not isinstance(payload, list) or len(payload) < 2:
            break

        meta = payload[0]
        rows = payload[1]
        if not rows:
            break

        for row in rows:
            year_raw = row.get("date")
            value = safe_float(row.get("value"))
            if year_raw is None or value is None:
                continue

            try:
                year = int(year_raw)
            except (TypeError, ValueError):
                continue

            results.append({"year": year, "value": value})

        total_pages = int(meta.get("pages", 1))
        if page >= total_pages:
            break

        page += 1
        time.sleep(0.1)

    results.sort(key=lambda x: x["year"], reverse=True)
    return results


def build_metric_object(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "values_by_year": {str(item["year"]): item["value"] for item in history}
    }


def build_country_record(country_name: str, iso3: str, metrics_history: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    metrics_out = {}
    for metric_name, history in metrics_history.items():
        metrics_out[metric_name] = build_metric_object(history)

    return {
        "country": country_name,
        "iso3": iso3,
        "metrics": metrics_out
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch World Bank metrics for all years and write one JSON file per UN-recognized country.")
    parser.add_argument("--out-dir", required=True, help="Output folder for JSON files")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "country-metrics-fetcher/1.0"})
    retry_strategy = Retry(
    total=5,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
)
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    all_countries_output = []
    total = len(UN_RECOGNIZED_COUNTRIES)

    for i, country in enumerate(UN_RECOGNIZED_COUNTRIES, start=1):
        country_name = country["name"]
        iso3 = country["iso3"]

        print(f"[{i}/{total}] Fetching {country_name} ({iso3})")

        metrics_history = {}
        for metric_name, indicator_code in FINAL_STAGE1_METRICS.items():
            metrics_history[metric_name] = fetch_indicator_all_years_for_country(iso3, indicator_code, session)
            time.sleep(0.15)

        record = build_country_record(country_name, iso3, metrics_history)
        all_countries_output.append(record)

        filename = f"{slugify(country_name)}.json"
        path = os.path.join(args.out_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

    combined_path = os.path.join(args.out_dir, "all_countries.json")
    with open(combined_path, "w", encoding="utf-8") as f:
        json.dump(all_countries_output, f, ensure_ascii=False, indent=2)

    print(f"\nDone. Wrote {total} country files and all_countries.json to {args.out_dir}")


if __name__ == "__main__":
    main()