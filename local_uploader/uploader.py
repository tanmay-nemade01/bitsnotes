import os
import sys
import time
import shutil
import json
import datetime
import boto3
import urllib.request
import urllib.parse
import urllib.error
import io
from dotenv import load_dotenv
from html.parser import HTMLParser

class HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.title = ""
        self.in_ignored_tag = False
        self.in_title = False
        self.ignored_tags = {"style", "script", "head"}
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self.in_title = True
        elif tag.lower() in self.ignored_tags:
            self.in_ignored_tag = True
            
    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False
        elif tag.lower() in self.ignored_tags:
            self.in_ignored_tag = False
            
    def handle_data(self, data):
        if self.in_title:
            self.title = data.strip()
        elif not self.in_ignored_tag:
            self.text.append(data)
            
    def get_text(self):
        return " ".join("".join(self.text).split())

# Load environment variables from the .env file
load_dotenv()

CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
UPLOAD_SECRET = os.getenv("UPLOAD_SECRET")
WEBSITE_URL = os.getenv("WEBSITE_URL")

# Local directories for watching and moving files
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WATCH_DIR = os.path.join(BASE_DIR, "watch_folder")
PROCESSED_DIR = os.path.join(BASE_DIR, "processed_folder")

# Ensure the watch and processed directories exist
os.makedirs(WATCH_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

# Global set of file paths currently being processed to prevent watchdog double-processing
_processing_files: set = set()

def upload_to_r2(key, body, content_type):
    """Uploads a file to R2. Uses HTTP API upload if WEBSITE_URL & UPLOAD_SECRET are set,
    otherwise falls back to S3 API via boto3."""
    if WEBSITE_URL and UPLOAD_SECRET:
        # Use HTTP API
        target_url = f"{WEBSITE_URL.rstrip('/')}/api/upload?key={urllib.parse.quote(key)}"
        req = urllib.request.Request(
            target_url,
            data=body,
            headers={
                "Authorization": f"Bearer {UPLOAD_SECRET}",
                "Content-Type": content_type,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            method="PUT"
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status == 200:
                    return True
                else:
                    raise Exception(f"HTTP Status {response.status}")
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode('utf-8')
            except Exception:
                err_body = ""
            raise Exception(f"HTTP Upload failed with status {e.code}: {err_body}")
        except Exception as e:
            raise Exception(f"HTTP Upload failed: {e}")
    else:
        # Use standard S3 client
        s3_client = get_r2_client()
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=body,
            ContentType=content_type
        )
        return True

def get_r2_client():
    """Initializes the S3-compatible client for Cloudflare R2."""
    return boto3.client(
        service_name="s3",
        endpoint_url=f"https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto"  # R2 expects region_name to be 'auto'
    )



def process_html(html_path):
    """Processes an HTML file's content and uploads it to R2, alongside its companion metadata JSON."""
    # Normalise path and skip if already being processed (prevents watchdog double-processing)
    html_path = os.path.normpath(html_path)
    if html_path in _processing_files:
        return
    _processing_files.add(html_path)
    raw_filename = os.path.basename(html_path)
    
    # 1. Parse Subject / Lecture from relative directory structure
    # Expected: watch_folder/Subject/Lecture N/notes.html  OR  watch_folder/Subject/lecture1.html
    rel_path = os.path.relpath(html_path, WATCH_DIR)
    parts = rel_path.split(os.sep)
    filename = parts[-1]
    doc_name, ext = os.path.splitext(filename)

    if len(parts) >= 3:
        # Subject/Lecture/file.html — lecture folder name is the R2 lecture key
        subject_name = parts[0]
        lecture_name = parts[1]
        doc_name = lecture_name
    elif len(parts) == 2:
        # Subject/file.html — lecture name from HTML filename
        subject_name = parts[0]
    else:
        # HTML is directly in watch_folder root (discouraged)
        subject_name = "General"

    if ext.lower() not in (".html", ".htm"):
        return

    print(f"\n[*] New HTML detected in subject '{subject_name}': '{filename}'")
    print(f"[*] Waiting for the file to finish writing to disk...")
    
    # Wait for file to copy/write fully
    prev_size = -1
    retries = 0
    while retries < 30:
        try:
            curr_size = os.path.getsize(html_path)
            if curr_size == prev_size and curr_size > 0:
                # File size is stable, check if it can be opened
                with open(html_path, 'r', encoding='utf-8') as f:
                    break
            prev_size = curr_size
        except (OSError, UnicodeDecodeError):
            pass
        time.sleep(1)
        retries += 1

    # Form unique document path in R2 as a two-level folder: Subject/LectureName
    r2_doc_id = f"{subject_name}/{doc_name}"
    print(f"[*] Processing HTML document as R2 path: '{r2_doc_id}/'")
    
    try:
        # Read HTML content
        with open(html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        # Parse text and title using HTMLTextExtractor
        parser = HTMLTextExtractor()
        parser.feed(html_content)
        extracted_text = parser.get_text()
        parsed_title = parser.title

        page_transcripts = [extracted_text]

        # 2. Handle Companion JSON Metadata
        html_base, _ = os.path.splitext(filename)
        json_path = os.path.join(os.path.dirname(html_path), f"{html_base}.json")
        metadata = None
        
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                print(f"[+] Found custom companion JSON: '{os.path.basename(json_path)}'")
            except Exception as e:
                print(f"[!] Error reading custom companion JSON: {e}")
        else:
            # Fallback: Extract from the embedded script tag in the HTML content
            import re
            match = re.search(r'<script\s+type=["\']application\/json["\']\s+id=["\']lecture-metadata["\']\s*>(.*?)</script>', html_content, re.DOTALL)
            if match:
                try:
                    metadata = json.loads(match.group(1).strip())
                    print("[+] Extracted custom metadata from HTML embedded script tag.")
                except Exception as e:
                    print(f"[!] Found embedded metadata script but failed to parse: {e}")

        if metadata is None:
            # Generate default skeleton metadata for future uploads without a JSON file
            default_title = parsed_title if parsed_title else doc_name.replace("_", " ").replace("-", " ").strip().title()
            
            # Use the first 200 chars of extracted plain text as dynamic description/summary
            clean_snippet = extracted_text[:200].strip()
            if len(extracted_text) > 200:
                clean_snippet += "..."
            default_summary = clean_snippet if clean_snippet else f"Lecture notes and study guide for {doc_name} under the {subject_name} course."

            metadata = {
                "title": default_title,
                "subject": subject_name,
                "gradeLevel": "Undergraduate",
                "datePublished": datetime.date.today().strftime("%Y-%m-%d"),
                "targetAudience": f"Students studying {subject_name}.",
                "summary": default_summary,
                "keyConcepts": [
                    f"Understand the core concepts of {doc_name}.",
                    f"Analyze key methodologies discussed in the {subject_name} lecture."
                ],
                "sections": [
                    {
                        "title": "Introduction",
                        "pages": "HTML Note",
                        "description": "Foundational topics and introductory content."
                    }
                ],
                "quiz": [
                    {
                        "question": f"What is the primary topic of this {subject_name} lecture?",
                        "options": [
                            doc_name.replace("_", " ").title(),
                            "An unrelated introductory topic",
                            "None of the above"
                        ],
                        "answerIndex": 0,
                        "explanation": f"This lecture focuses specifically on {doc_name}."
                    }
                ]
            }

        # Update metadata with page transcripts
        metadata["pageTranscripts"] = []

        # Save metadata JSON file locally ONLY if a companion JSON file already exists on disk
        if os.path.exists(json_path):
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, indent=2, ensure_ascii=False)
                print(f"[+] Saved/Updated local companion JSON: '{os.path.basename(json_path)}'")
            except Exception as e:
                print(f"[!] Failed to save local companion JSON: {e}")

        # 3. Upload metadata to R2 under the unique key prefix
        metadata_key = f"{r2_doc_id}/metadata.json"
        metadata_json_bytes = json.dumps(metadata, indent=2, ensure_ascii=False).encode('utf-8')
        upload_to_r2(metadata_key, metadata_json_bytes, "application/json")
        print(f"[+] Uploaded metadata JSON to R2: '{metadata_key}'")

        # 4. Upload HTML file to R2 directly
        html_key = f"{r2_doc_id}/content.html"
        html_bytes = html_content.encode('utf-8')
        upload_to_r2(html_key, html_bytes, "text/html")
        print(f"[+] Uploaded HTML content to R2: '{html_key}'")
        
        # 5. Move files to processed_folder mirroring watch_folder layout
        rel_for_processed = os.path.relpath(os.path.dirname(html_path), WATCH_DIR)
        dest_subfolder = (
            os.path.join(PROCESSED_DIR, rel_for_processed)
            if rel_for_processed != "."
            else (os.path.join(PROCESSED_DIR, subject_name) if subject_name != "General" else PROCESSED_DIR)
        )
        os.makedirs(dest_subfolder, exist_ok=True)

        dest_html_path = os.path.join(dest_subfolder, filename)
        if os.path.exists(dest_html_path):
            base, ext_part = os.path.splitext(filename)
            dest_html_path = os.path.join(dest_subfolder, f"{base}_{int(time.time())}{ext_part}")
        
        # Retry move to handle transient WinError 32 file locks (Windows keeps file open briefly)
        for attempt in range(5):
            try:
                shutil.move(html_path, dest_html_path)
                break
            except OSError:
                if attempt < 4:
                    time.sleep(1)
                else:
                    raise
        print(f"[+] Moved source HTML to processed folder: '{os.path.relpath(dest_html_path, PROCESSED_DIR)}'")    
        
        # Move companion JSON
        if os.path.exists(json_path):
            json_filename = os.path.basename(json_path)
            dest_json_path = os.path.join(dest_subfolder, json_filename)
            if os.path.exists(dest_json_path):
                base, ext_part = os.path.splitext(json_filename)
                dest_json_path = os.path.join(dest_subfolder, f"{base}_{int(time.time())}{ext_part}")
            shutil.move(json_path, dest_json_path)
            print(f"[+] Moved companion JSON to processed folder: '{os.path.relpath(dest_json_path, PROCESSED_DIR)}'")
            
    except Exception as e:
        print(f"[!] Error processing '{raw_filename}': {e}")
        print("[!] File left in watch folder. Please resolve the issue and the script will retry.")
    finally:
        _processing_files.discard(html_path)

# PDFHandler class removed because background folder watching is disabled.


def clear_r2_bucket():
    """Deletes ALL objects in the R2 bucket using the S3 API directly (not via HTTP upload endpoint)."""
    print(f"[*] Connecting to R2 to clear all objects in bucket '{R2_BUCKET_NAME}'...")
    s3 = get_r2_client()
    
    deleted_count = 0
    continuation_token = None
    
    while True:
        list_kwargs = {"Bucket": R2_BUCKET_NAME, "MaxKeys": 1000}
        if continuation_token:
            list_kwargs["ContinuationToken"] = continuation_token
        
        response = s3.list_objects_v2(**list_kwargs)
        objects = response.get("Contents", [])
        
        if not objects:
            break
        
        delete_payload = {"Objects": [{"Key": obj["Key"]} for obj in objects]}
        s3.delete_objects(Bucket=R2_BUCKET_NAME, Delete=delete_payload)
        deleted_count += len(objects)
        print(f"    -> Deleted {deleted_count} objects so far...")
        
        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")
    
    print(f"[+] Bucket cleared. Total objects deleted: {deleted_count}")


def reupload_all():
    """Clears the R2 bucket and re-processes all HTML files found in the processed_folder."""
    print("==========================================================")
    print("      BitsNotes R2 Re-Upload Mode (Reprocess HTMLs)       ")
    print("==========================================================")
    
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        exit(1)
    
    # Step 1: Clear R2 bucket
    clear_r2_bucket()

    
    # Step 2: Move all HTMLs from processed_folder back to watch_folder to reprocess
    print(f"[*] Moving HTML files from processed_folder back to watch_folder for reprocessing...")
    moved = 0
    for root, dirs, files in os.walk(PROCESSED_DIR):
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".html", ".htm"):
                src_file = os.path.join(root, filename)
                # Preserve subfolder structure relative to PROCESSED_DIR
                rel = os.path.relpath(root, PROCESSED_DIR)
                dest_dir = os.path.join(WATCH_DIR, rel) if rel != "." else WATCH_DIR
                os.makedirs(dest_dir, exist_ok=True)
                dest_file = os.path.join(dest_dir, filename)
                shutil.move(src_file, dest_file)
                print(f"    -> Moved: {os.path.relpath(src_file, PROCESSED_DIR)} -> watch_folder")
                moved += 1
                
                # Also move companion JSON if present
                base = os.path.splitext(filename)[0]
                src_json = os.path.join(root, f"{base}.json")
                if os.path.exists(src_json):
                    dest_json = os.path.join(dest_dir, f"{base}.json")
                    shutil.move(src_json, dest_json)
    
    print(f"[*] Moved {moved} HTML document(s) back to watch_folder. Starting reprocess...")
    
    # Step 3: Process all HTML documents now in watch_folder
    for root, dirs, files in os.walk(WATCH_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".html", ".htm"):
                process_html(os.path.join(root, filename))
    
    print("\n[+] Re-upload complete!")


if __name__ == "__main__":
    print("==========================================================")
    print("         Cloudflare R2 Secure HTML Uploader               ")
    print("==========================================================")
    
    # Check for --reupload flag: clear R2 and reprocess all HTML documents from processed_folder
    if "--reupload" in sys.argv:
        reupload_all()
        exit(0)
    
    # Simple configuration check
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        print("[!] Please open 'local_uploader/.env' and fill in your Cloudflare details.")
        exit(1)
        
    # Process any HTML documents that are already in watch_folder recursively
    print(f"[*] Scanning watch folder recursively for HTMLs to upload...")
    found_docs = []
    for root, dirs, files in os.walk(WATCH_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".html", ".htm"):
                found_docs.append(os.path.join(root, filename))
    
    if not found_docs:
        print("[*] No HTML notes found in the watch folder.")
    else:
        print(f"[*] Found {len(found_docs)} HTML document(s) to process.")
        for doc_path in found_docs:
            process_html(doc_path)
            
    print("\n[+] Processing finished. Uploader script stopped.")
