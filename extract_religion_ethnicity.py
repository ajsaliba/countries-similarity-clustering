import json
import os
import csv

json_dir = r"Data\Wiki Infobox\JSON"

# Collect all data
countries_data = []

# Process all JSON files
for filename in sorted(os.listdir(json_dir)):
    if filename.endswith(".json") and filename != "all_countries.json":
        filepath = os.path.join(json_dir, filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            country_name = data.get("country", "Unknown")
            infobox = data.get("infobox", {})
            general = infobox.get("General", {})
            
            religions = general.get("Religion")
            ethnic_groups = general.get("Ethnic groups")
            
            # Format religions
            religions_str = ""
            if religions:
                if isinstance(religions, dict):
                    religions_str = ", ".join(religions.keys())
                else:
                    religions_str = str(religions)
            else:
                religions_str = "No data"
            
            # Format ethnic groups
            ethnic_groups_str = ""
            if ethnic_groups:
                if isinstance(ethnic_groups, dict):
                    ethnic_groups_str = ", ".join(ethnic_groups.keys())
                else:
                    ethnic_groups_str = str(ethnic_groups)
            else:
                ethnic_groups_str = "No data"
            
            countries_data.append({
                "Country": country_name,
                "Religions": religions_str,
                "Ethnic Groups": ethnic_groups_str
            })
        
        except Exception as e:
            print(f"Error reading {filename}: {e}")

# Write to CSV file
output_csv = "religion_ethnicity_summary.csv"
with open(output_csv, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["Country", "Religions", "Ethnic Groups"])
    writer.writeheader()
    writer.writerows(countries_data)

print(f"✓ CSV file created: {output_csv}")

# Also create a formatted text file
output_txt = "religion_ethnicity_summary.txt"
with open(output_txt, 'w', encoding='utf-8') as f:
    f.write("=" * 100 + "\n")
    f.write("RELIGION AND ETHNIC GROUPS SUMMARY FOR ALL COUNTRIES\n")
    f.write("=" * 100 + "\n\n")
    
    for country in countries_data:
        f.write(f"Country: {country['Country']}\n")
        f.write(f"  Religions: {country['Religions']}\n")
        f.write(f"  Ethnic Groups: {country['Ethnic Groups']}\n")
        f.write("-" * 100 + "\n")

print(f"✓ Text file created: {output_txt}")
print(f"\n✓ Total countries processed: {len(countries_data)}")
