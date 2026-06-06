import socket
# Force IPv4 DNS lookups to bypass slow IPv6 (AAAA) resolution timeouts
orig_getaddrinfo = socket.getaddrinfo
socket.getaddrinfo = lambda host, port, family=0, type=0, proto=0, flags=0: orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

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
from concurrent.futures import ThreadPoolExecutor, as_completed
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

# Local directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NOTES_DIR = os.path.join(BASE_DIR, "notes")
MANIFEST_PATH = os.path.join(BASE_DIR, ".sync_manifest.json")

# Ensure the notes directory exists
os.makedirs(NOTES_DIR, exist_ok=True)

def get_r2_client():
    """Initializes the S3-compatible client for Cloudflare R2."""
    return boto3.client(
        service_name="s3",
        endpoint_url=f"https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto"
    )

def upload_to_r2(key, body, content_type):
    """Uploads a file to R2. Uses HTTP API upload if WEBSITE_URL & UPLOAD_SECRET are set,
    otherwise falls back to S3 API via boto3."""
    if WEBSITE_URL and UPLOAD_SECRET:
        target_url = f"{WEBSITE_URL.rstrip('/')}/api/upload?key={urllib.parse.quote(key)}"
        origin = WEBSITE_URL.rstrip('/')
        req = urllib.request.Request(
            target_url,
            data=body,
            headers={
                "Authorization": f"Bearer {UPLOAD_SECRET}",
                "Content-Type": content_type,
                "Origin": origin,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            method="PUT"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
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
        s3_client = get_r2_client()
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=body,
            ContentType=content_type
        )
        return True

def delete_from_r2(key):
    """Deletes a file from R2. Uses HTTP API delete if WEBSITE_URL & UPLOAD_SECRET are set,
    otherwise falls back to S3 API via boto3."""
    if WEBSITE_URL and UPLOAD_SECRET:
        target_url = f"{WEBSITE_URL.rstrip('/')}/api/upload?key={urllib.parse.quote(key)}"
        origin = WEBSITE_URL.rstrip('/')
        req = urllib.request.Request(
            target_url,
            headers={
                "Authorization": f"Bearer {UPLOAD_SECRET}",
                "Origin": origin,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            method="DELETE"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                if response.status == 200:
                    return True
                else:
                    raise Exception(f"HTTP Status {response.status}")
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode('utf-8')
            except Exception:
                err_body = ""
            raise Exception(f"HTTP Delete failed with status {e.code}: {err_body}")
        except Exception as e:
            raise Exception(f"HTTP Delete failed: {e}")
    else:
        s3_client = get_r2_client()
        s3_client.delete_object(
            Bucket=R2_BUCKET_NAME,
            Key=key
        )
        return True

def get_file_mtime_iso(filepath):
    """Returns the modification time of a file as a human-readable ISO 8601 string."""
    mtime = os.path.getmtime(filepath)
    return datetime.datetime.fromtimestamp(mtime).isoformat()

def load_manifest():
    """Loads the synchronization state manifest."""
    if os.path.exists(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Error reading manifest: {e}. Starting fresh.")
    return {"files": {}}

def save_manifest(manifest):
    """Saves the synchronization state manifest."""
    try:
        with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[!] Failed to save manifest: {e}")


def should_process(html_path, manifest, force=False):
    """Checks whether the file (or its companion JSON) has changed since last sync."""
    if force:
        return True
        
    rel_key = os.path.relpath(html_path, NOTES_DIR).replace(os.sep, '/')
    
    current_html_mtime = get_file_mtime_iso(html_path)
    
    html_base, _ = os.path.splitext(html_path)
    json_path = f"{html_base}.json"
    current_json_mtime = get_file_mtime_iso(json_path) if os.path.exists(json_path) else None
    
    entry = manifest.get("files", {}).get(rel_key)
    if not entry:
        return True
        
    recorded_html_mtime = entry.get("html_mtime")
    if recorded_html_mtime is None or current_html_mtime > recorded_html_mtime:
        return True
        
    recorded_json_mtime = entry.get("json_mtime")
    if current_json_mtime is not None:
        if recorded_json_mtime is None or current_json_mtime > recorded_json_mtime:
            return True
    elif recorded_json_mtime is not None:
        # Companion JSON was deleted, so we should reprocess metadata.json fallback
        return True
        
    return False

def process_html(html_path):
    """Processes an HTML file's content and uploads it to R2.
    Returns metadata dict for manifest if successful, otherwise None."""
    html_path = os.path.normpath(html_path)
    raw_filename = os.path.basename(html_path)
    
    # 1. Parse Subject / Lecture from relative directory structure
    rel_path = os.path.relpath(html_path, NOTES_DIR)
    parts = rel_path.split(os.sep)
    filename = parts[-1]
    doc_name, ext = os.path.splitext(filename)

    if len(parts) >= 3:
        # Subject/Lecture/file.html
        subject_name = parts[0]
        lecture_name = parts[1]
        doc_name = lecture_name
    elif len(parts) == 2:
        # Subject/file.html
        subject_name = parts[0]
    else:
        # HTML directly in notes root (discouraged)
        subject_name = "General"

    if ext.lower() not in (".html", ".htm"):
        return None

    r2_doc_id = f"{subject_name}/{doc_name}"
    
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
            except Exception as e:
                print(f"[!] Error reading custom companion JSON for '{filename}': {e}")
        else:
            # Fallback: Extract from the embedded script tag in the HTML content
            import re
            match = re.search(r'<script\s+type=["\']application\/json["\']\s+id=["\']lecture-metadata["\']\s*>(.*?)</script>', html_content, re.DOTALL)
            if match:
                try:
                    metadata = json.loads(match.group(1).strip())
                except Exception as e:
                    print(f"[!] Found embedded metadata script but failed to parse for '{filename}': {e}")

        if metadata is None:
            # Generate default skeleton metadata for future uploads without a JSON file
            default_title = parsed_title if parsed_title else doc_name.replace("_", " ").replace("-", " ").strip().title()
            
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

        # Update metadata with page transcripts if not already present
        if "pageTranscripts" not in metadata or not metadata["pageTranscripts"]:
            metadata["pageTranscripts"] = page_transcripts

        # Save metadata JSON file locally ONLY if a companion JSON file already exists on disk
        if os.path.exists(json_path):
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[!] Failed to save local companion JSON for '{filename}': {e}")

        # 3. Upload metadata to R2
        metadata_key = f"{r2_doc_id}/metadata.json"
        metadata_json_bytes = json.dumps(metadata, indent=2, ensure_ascii=False).encode('utf-8')
        upload_to_r2(metadata_key, metadata_json_bytes, "application/json")

        # 4. Upload HTML file to R2
        html_key = f"{r2_doc_id}/content.html"
        html_bytes = html_content.encode('utf-8')
        upload_to_r2(html_key, html_bytes, "text/html")
        
        print(f"[+] Successfully synced and uploaded: '{r2_doc_id}'")
        
        rel_key = os.path.relpath(html_path, NOTES_DIR).replace(os.sep, '/')
        return {
            "rel_key": rel_key,
            "html_mtime": get_file_mtime_iso(html_path),
            "json_mtime": get_file_mtime_iso(json_path) if os.path.exists(json_path) else None,
            "last_uploaded": datetime.datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"[!] Error processing '{raw_filename}': {e}")
        return None

def clear_r2_bucket():
    """Deletes ALL objects in the R2 bucket using the S3 API directly."""
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

def prune_deleted_files(manifest):
    """Identifies entries in the manifest that no longer exist on disk and deletes them from R2 in parallel."""
    pruning_candidates = []
    
    for rel_path, entry in list(manifest.get("files", {}).items()):
        local_path = os.path.join(NOTES_DIR, rel_path.replace('/', os.sep))
        if not os.path.exists(local_path):
            pruning_candidates.append(rel_path)
            
    if not pruning_candidates:
        return
        
    print(f"[*] Detected {len(pruning_candidates)} deleted note(s) to prune from R2...")
    
    def prune_worker(rel_path):
        parts = rel_path.split('/')
        filename = parts[-1]
        doc_name, _ = os.path.splitext(filename)
        if len(parts) >= 3:
            subject_name = parts[0]
            doc_name = parts[1]
        elif len(parts) == 2:
            subject_name = parts[0]
        else:
            subject_name = "General"
            
        r2_doc_id = f"{subject_name}/{doc_name}"
        html_key = f"{r2_doc_id}/content.html"
        metadata_key = f"{r2_doc_id}/metadata.json"
        
        try:
            delete_from_r2(html_key)
            delete_from_r2(metadata_key)
            print(f"    [-] Pruned from R2: '{r2_doc_id}'")
            return rel_path
        except Exception as e:
            print(f"    [!] Error pruning '{r2_doc_id}' from R2: {e}")
            return None

    pruned_files = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(prune_worker, p): p for p in pruning_candidates}
        for future in as_completed(futures):
            res = future.result()
            if res:
                pruned_files.append(res)
                
    for rel_path in pruned_files:
        manifest["files"].pop(rel_path, None)
        
    if pruned_files:
        save_manifest(manifest)
        print(f"[+] Pruning complete. Removed {len(pruned_files)} note(s) from R2 and manifest.")

def reupload_all():
    """Clears the R2 bucket, resets the sync manifest, and force-uploads all notes."""
    print("==========================================================")
    print("      BitsNotes R2 Re-Upload Mode (Reprocess HTMLs)       ")
    print("==========================================================")
    
    has_r2_creds = all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME])
    has_http_creds = WEBSITE_URL and UPLOAD_SECRET
    
    if not (has_r2_creds or has_http_creds):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        exit(1)
    
    if has_r2_creds:
        clear_r2_bucket()
    else:
        print("[!] Warning: Direct S3 credentials not found, skipping R2 bucket clear.")
        print("[!] Sync will overwrite existing files but will not delete untracked files in R2.")
        
    if os.path.exists(MANIFEST_PATH):
        try:
            os.remove(MANIFEST_PATH)
            print("[+] Cleared sync manifest.")
        except OSError as e:
            print(f"[!] Error clearing manifest: {e}")
            
    manifest = {"files": {}}
    
    found_docs = []
    for root, dirs, files in os.walk(NOTES_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".html", ".htm"):
                found_docs.append(os.path.join(root, filename))
                
    if not found_docs:
        print("[*] No HTML notes found in the notes folder.")
    else:
        print(f"[*] Found {len(found_docs)} HTML document(s) to process in parallel...")
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(process_html, doc_path): doc_path for doc_path in found_docs}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    rel_key = result["rel_key"]
                    manifest["files"][rel_key] = {
                        "html_mtime": result["html_mtime"],
                        "json_mtime": result["json_mtime"],
                        "last_uploaded": result["last_uploaded"]
                    }
        save_manifest(manifest)
            
    print("\n[+] Re-upload complete!")


if __name__ == "__main__":
    print("==========================================================")
    print("         Cloudflare R2 Secure Sync HTML Uploader          ")
    print("==========================================================")
    
    force_sync = "--force" in sys.argv
    prune_sync = "--prune" in sys.argv
    reupload = "--reupload" in sys.argv
    
    if reupload:
        reupload_all()
        exit(0)
    
    has_r2_creds = all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME])
    has_http_creds = WEBSITE_URL and UPLOAD_SECRET
    
    if not (has_r2_creds or has_http_creds):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        print("[!] Please open 'local_uploader/.env' and fill in your Cloudflare details.")
        exit(1)
        
    manifest = load_manifest()
    
    print(f"[*] Scanning notes folder recursively for HTMLs to sync...")
    found_docs = []
    for root, dirs, files in os.walk(NOTES_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".html", ".htm"):
                found_docs.append(os.path.join(root, filename))
    
    if not found_docs:
        print("[*] No HTML notes found in the notes folder.")
    else:
        docs_to_process = [d for d in found_docs if should_process(d, manifest, force_sync)]
        
        if not docs_to_process:
            print("[+] All files are up-to-date. Nothing to upload.")
        else:
            print(f"[*] Found {len(found_docs)} HTML document(s) in total.")
            print(f"[*] Processing {len(docs_to_process)} new or modified HTML document(s) in parallel (max 5 threads)...")
            
            uploaded_count = 0
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(process_html, doc_path): doc_path for doc_path in docs_to_process}
                for future in as_completed(futures):
                    result = future.result()
                    if result:
                        rel_key = result["rel_key"]
                        manifest["files"][rel_key] = {
                            "html_mtime": result["html_mtime"],
                            "json_mtime": result["json_mtime"],
                            "last_uploaded": result["last_uploaded"]
                        }
                        uploaded_count += 1
            save_manifest(manifest)
            print(f"[+] Sync finished. Uploaded/updated {uploaded_count} note(s).")
            
    if prune_sync:
        prune_deleted_files(manifest)
    
    print("\n[+] Processing finished. Uploader script stopped.")
