import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
import boto3
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
UPLOAD_SECRET = os.getenv("UPLOAD_SECRET")
WEBSITE_URL = os.getenv("WEBSITE_URL")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WATCH_DIR = os.path.join(BASE_DIR, "watch_folder")
PROCESSED_DIR = os.path.join(BASE_DIR, "processed_folder")

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
        s3_client = get_r2_client()
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=body,
            ContentType=content_type
        )
        return True

def upload_json_file(json_path, base_dir_path):
    """Uploads a single JSON metadata file to R2 based on its relative path from base_dir_path."""
    rel_path = os.path.relpath(json_path, base_dir_path)
    parts = rel_path.split(os.sep)
    filename = parts[-1]
    doc_name, _ = os.path.splitext(filename)

    if len(parts) >= 3:
        subject_name = parts[0]
        lecture_name = parts[1]
        doc_name = lecture_name
    elif len(parts) == 2:
        subject_name = parts[0]
    else:
        subject_name = "General"

    r2_doc_id = f"{subject_name}/{doc_name}"
    metadata_key = f"{r2_doc_id}/metadata.json"

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        metadata_json_bytes = json.dumps(metadata, indent=2).encode('utf-8')
        upload_to_r2(metadata_key, metadata_json_bytes, "application/json")
        print(f"[+] Successfully uploaded: '{rel_path}' -> R2 '{metadata_key}'")
        return True
    except Exception as e:
        print(f"[!] Failed to upload '{rel_path}': {e}")
        return False

def main():
    print("==========================================================")
    print("         BitsNotes R2 Metadata JSON Bulk Uploader        ")
    print("==========================================================")
    
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        print("[!] ERROR: Cloudflare R2 Credentials missing in .env file.")
        sys.exit(1)

    # 1. Scan processed_folder for JSON files and upload them
    print(f"\n[*] Scanning processed folder: '{PROCESSED_DIR}'...")
    uploaded_processed = 0
    for root, _, files in os.walk(PROCESSED_DIR):
        for file in files:
            if file.lower().endswith(".json"):
                json_path = os.path.join(root, file)
                if upload_json_file(json_path, PROCESSED_DIR):
                    uploaded_processed += 1

    # 2. Scan watch_folder for JSON files, upload them, and remove them if duplicates
    print(f"\n[*] Scanning watch folder: '{WATCH_DIR}'...")
    uploaded_watch = 0
    removed_watch = 0
    for root, _, files in os.walk(WATCH_DIR):
        for file in files:
            if file.lower().endswith(".json"):
                json_path = os.path.join(root, file)
                # First upload it to be safe
                if upload_json_file(json_path, WATCH_DIR):
                    uploaded_watch += 1
                
                # Check if it also exists in processed_folder in the same relative subfolder path
                rel_path = os.path.relpath(json_path, WATCH_DIR)
                processed_target_path = os.path.join(PROCESSED_DIR, rel_path)
                if os.path.exists(processed_target_path):
                    # It's a duplicate of a processed JSON. Clean it up from watch_folder.
                    try:
                        os.remove(json_path)
                        print(f"[-] Removed duplicate JSON from watch folder: '{rel_path}'")
                        removed_watch += 1
                    except Exception as e:
                        print(f"[!] Error removing '{rel_path}': {e}")

    print(f"\n[+] Bulk Upload Complete!")
    print(f"    - Uploaded from processed folder: {uploaded_processed}")
    print(f"    - Uploaded from watch folder: {uploaded_watch}")
    print(f"    - Cleaned up from watch folder: {removed_watch}")

if __name__ == "__main__":
    main()
