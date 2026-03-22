import json
import os

json_dir = r"Data\Wiki Infobox\JSON"
output_file = r"all_countries_raw.json"

countries = []

# Process all JSON files
for filename in sorted(os.listdir(json_dir)):
    if filename.endswith(".json") and filename != "all_countries.json" and filename != "all_countries_raw.json":
        filepath = os.path.join(json_dir, filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            countries.append(data)
        except Exception as e:
            print(f"Error reading {filename}: {e}")

# Write combined data to output file
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(countries, f, indent=2, ensure_ascii=False)

print(f"✓ Combined {len(countries)} countries into {output_file}")
