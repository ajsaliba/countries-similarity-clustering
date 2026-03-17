import json
import re
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

def sanitize_tag(tag: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", tag.strip())
    if not cleaned:
        cleaned = "item"
    if cleaned[0].isdigit():
        cleaned = f"n_{cleaned}"
    return cleaned

def append_value(parent: Element, key: str, value) -> None:
    tag = sanitize_tag(key)

    if isinstance(value, dict):
        node = SubElement(parent, tag)
        for child_key, child_value in value.items():
            append_value(node, str(child_key), child_value)
        return

    if isinstance(value, list):
        list_node = SubElement(parent, tag)
        for item in value:
            append_value(list_node, "item", item)
        return

    node = SubElement(parent, tag)
    node.text = "" if value is None else str(value)

def json_to_xml(data) -> Element:
    root = Element("countries")

    if isinstance(data, list):
        for record in data:
            record_node = SubElement(root, "country_record")
            if isinstance(record, dict):
                for key, value in record.items():
                    append_value(record_node, str(key), value)
            else:
                append_value(record_node, "value", record)
    elif isinstance(data, dict):
        for key, value in data.items():
            append_value(root, str(key), value)
    else:
        append_value(root, "value", data)

    return root

def main() -> None:
    base_dir = Path(__file__).parent.parent / "Data"
    json_dir = base_dir / "JSON"
    xml_dir = base_dir / "XML"
    xml_dir.mkdir(parents=True, exist_ok=True)

    for json_file in json_dir.glob("*.json"):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        root = json_to_xml(data)
        xml_file = xml_dir / (json_file.stem + ".xml")
        raw_xml = tostring(root, encoding="utf-8")
        pretty_xml = minidom.parseString(raw_xml).toprettyxml(indent="  ", encoding="utf-8")
        xml_file.write_bytes(pretty_xml)
        print(f"XML written to {xml_file}")

if __name__ == "__main__":
    main()
