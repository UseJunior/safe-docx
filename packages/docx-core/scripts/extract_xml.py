
import zipfile
import sys
import xml.dom.minidom

def extract_xml(docx_path, output_path):
    with zipfile.ZipFile(docx_path, 'r') as zip_ref:
        xml_content = zip_ref.read('word/document.xml')
        dom = xml.dom.minidom.parseString(xml_content)
        with open(output_path, 'w') as f:
            f.write(dom.toprettyxml(indent='  '))

if __name__ == "__main__":
    extract_xml(sys.argv[1], sys.argv[2])
