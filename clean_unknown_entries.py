import json
import os

json_dir = r"Data\Wiki Infobox\JSON"

def clean_unknown_entries(obj):
    """
    Recursively removes "Unknown": null entries from the dataset.
    
    Rules:
    1. If a dict only contains "Unknown": null, replace the entire dict with null
    2. If a dict contains "Unknown": null with other data, remove only "Unknown": null
    3. If removing "Unknown": null leaves an empty dict, replace with null
    4. Preserve valid null values not tied to "Unknown"
    """
    
    if isinstance(obj, dict):
        # First, recursively clean all nested values
        cleaned_dict = {}
        for key, value in obj.items():
            if key != "Unknown":  # Skip "Unknown" keys for now
                cleaned_dict[key] = clean_unknown_entries(value)
        
        # Now check the state of cleaned_dict
        if len(cleaned_dict) == 0:
            # If dict is empty after removing Unknown, return null
            return None
        else:
            # Return the cleaned dict with Unknown removed
            return cleaned_dict
    
    elif isinstance(obj, list):
        # Recursively clean list items
        return [clean_unknown_entries(item) for item in obj]
    
    else:
        # Return scalar values as-is
        return obj


# Process all JSON files
processed_count = 0
for filename in sorted(os.listdir(json_dir)):
    if filename.endswith(".json"):
        filepath = os.path.join(json_dir, filename)
        
        try:
            # Read the JSON file
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Clean the data
            cleaned_data = clean_unknown_entries(data)
            
            # Write back to the file
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(cleaned_data, f, indent=4, ensure_ascii=False)
            
            print(f"✓ {filename}")
            processed_count += 1
        
        except Exception as e:
            print(f"✗ Error processing {filename}: {e}")

print(f"\n✓ Successfully processed {processed_count} files")
print("All 'Unknown': null entries have been removed!")
