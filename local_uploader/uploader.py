import os
import sys
import time
import shutil
import json
import datetime
import fitz  # PyMuPDF
import boto3
import urllib.request
import urllib.parse
import urllib.error
import io
from PIL import Image
from dotenv import load_dotenv

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

def process_pdf(pdf_path):
    """Converts a PDF file's pages into WebP images and uploads them to R2, alongside its companion metadata JSON."""
    # Normalise path and skip if already being processed (prevents watchdog double-processing)
    pdf_path = os.path.normpath(pdf_path)
    if pdf_path in _processing_files:
        return
    _processing_files.add(pdf_path)
    raw_filename = os.path.basename(pdf_path)
    
    # 1. Parse Subject / Lecture from relative directory structure
    # Expected: watch_folder/Subject/Lecture N/notes.pdf  OR  watch_folder/Subject/lecture1.pdf
    rel_path = os.path.relpath(pdf_path, WATCH_DIR)
    parts = rel_path.split(os.sep)
    filename = parts[-1]
    doc_name, ext = os.path.splitext(filename)

    if len(parts) >= 3:
        # Subject/Lecture/file.pdf — lecture folder name is the R2 lecture key
        subject_name = parts[0]
        lecture_name = parts[1]
        doc_name = lecture_name
    elif len(parts) == 2:
        # Subject/file.pdf — lecture name from PDF filename
        subject_name = parts[0]
    else:
        # PDF is directly in watch_folder root (discouraged)
        subject_name = "General"

    if ext.lower() != ".pdf":
        return

    print(f"\n[*] New PDF detected in subject '{subject_name}': '{filename}'")
    print(f"[*] Waiting for the file to finish writing to disk...")
    
    # Wait for file to copy/write fully
    prev_size = -1
    retries = 0
    while retries < 30:
        try:
            curr_size = os.path.getsize(pdf_path)
            if curr_size == prev_size and curr_size > 0:
                # File size is stable, check if it can be opened
                with open(pdf_path, 'rb+'):
                    break
            prev_size = curr_size
        except OSError:
            pass
        time.sleep(1)
        retries += 1

    # Form unique document path in R2 as a two-level folder: Subject/LectureName
    r2_doc_id = f"{subject_name}/{doc_name}"
    print(f"[*] Processing document as R2 path: '{r2_doc_id}/'")
    
    try:
        # Open PDF using PyMuPDF
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        print(f"[*] Found {total_pages} pages in document.")

        # Extract text from all pages for SEO and accessibility
        page_transcripts = []
        for i in range(total_pages):
            page = doc.load_page(i)
            # Extract plain text
            raw_text = page.get_text("text") or ""
            # Clean consecutive whitespace and newlines
            clean_text = " ".join(raw_text.split()).strip()
            page_transcripts.append(clean_text)

        # 2. Handle Companion JSON Metadata
        pdf_base, _ = os.path.splitext(filename)
        json_path = os.path.join(os.path.dirname(pdf_path), f"{pdf_base}.json")
        metadata = None
        
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                print(f"[+] Found custom companion JSON: '{os.path.basename(json_path)}'")
            except Exception as e:
                print(f"[!] Error reading custom companion JSON: {e}")

        if metadata is None:
            # Generate default skeleton metadata for future uploads without a JSON file
            metadata = {
                "title": doc_name.replace("_", " ").replace("-", " ").strip().title(),
                "subject": subject_name,
                "gradeLevel": "Undergraduate",
                "datePublished": datetime.date.today().strftime("%Y-%m-%d"),
                "targetAudience": f"Students studying {subject_name}.",
                "summary": f"Lecture notes and study guide for {doc_name} under the {subject_name} course.",
                "keyConcepts": [
                    f"Understand the core concepts of {doc_name}.",
                    f"Analyze key methodologies discussed in the {subject_name} lecture."
                ],
                "sections": [
                    {
                        "title": "Introduction",
                        "pages": "Page 1",
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
        metadata["pageTranscripts"] = page_transcripts

        # Save metadata JSON file locally (updating existing or creating new)
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

        # 4. Render pages to WebP and upload
        for i in range(total_pages):
            page_num = i + 1
            print(f"    -> Rendering page {page_num}/{total_pages}...")
            
            # Load page
            page = doc.load_page(i)
            
            # Use a zoom factor of 1.5x (108 DPI) for a balance of crisp readability and small file size.
            zoom = 1.5
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            
            # Convert page to WebP bytes. Use Pillow to convert from PNG to WebP to avoid 
            # PyMuPDF compilation environments missing direct WebP support.
            try:
                png_bytes = pix.tobytes("png")
                img = Image.open(io.BytesIO(png_bytes))
                webp_io = io.BytesIO()
                img.save(webp_io, format="webp", quality=60)
                img_bytes = webp_io.getvalue()
            except Exception as e:
                # Fallback to direct WebP rendering if PIL/Pillow fails
                img_bytes = pix.tobytes("webp")
            
            # Pad page numbers to 3 digits
            page_key = f"{r2_doc_id}/page_{page_num:03d}.webp"
            
            # Upload WebP image directly to Cloudflare R2
            upload_to_r2(page_key, img_bytes, "image/webp")
            
        doc.close()
        print(f"[+] All pages successfully uploaded to R2 under folder '{r2_doc_id}/'")
        
        # 4. Move files to processed_folder mirroring watch_folder layout
        rel_for_processed = os.path.relpath(os.path.dirname(pdf_path), WATCH_DIR)
        dest_subfolder = (
            os.path.join(PROCESSED_DIR, rel_for_processed)
            if rel_for_processed != "."
            else (os.path.join(PROCESSED_DIR, subject_name) if subject_name != "General" else PROCESSED_DIR)
        )
        os.makedirs(dest_subfolder, exist_ok=True)

        dest_pdf_path = os.path.join(dest_subfolder, filename)
        if os.path.exists(dest_pdf_path):
            base, ext = os.path.splitext(filename)
            dest_pdf_path = os.path.join(dest_subfolder, f"{base}_{int(time.time())}{ext}")
        
        # Retry move to handle transient WinError 32 file locks (Windows keeps file open briefly)
        for attempt in range(5):
            try:
                shutil.move(pdf_path, dest_pdf_path)
                break
            except OSError:
                if attempt < 4:
                    time.sleep(1)
                else:
                    raise
        print(f"[+] Moved source PDF to processed folder: '{os.path.relpath(dest_pdf_path, PROCESSED_DIR)}'")    
        
        # Move companion JSON
        if os.path.exists(json_path):
            json_filename = os.path.basename(json_path)
            dest_json_path = os.path.join(dest_subfolder, json_filename)
            if os.path.exists(dest_json_path):
                base, ext = os.path.splitext(json_filename)
                dest_json_path = os.path.join(dest_subfolder, f"{base}_{int(time.time())}{ext}")
            shutil.move(json_path, dest_json_path)
            print(f"[+] Moved companion JSON to processed folder: '{os.path.relpath(dest_json_path, PROCESSED_DIR)}'")
            
    except Exception as e:
        print(f"[!] Error processing '{raw_filename}': {e}")
        print("[!] File left in watch folder. Please resolve the issue and the script will retry.")
    finally:
        _processing_files.discard(pdf_path)

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
    """Clears the R2 bucket and re-processes all PDFs found in the processed_folder."""
    print("==========================================================")
    print("     BitsNotes R2 Re-Upload Mode (Reprocess All PDFs)     ")
    print("==========================================================")
    
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        exit(1)
    
    # Step 1: Clear R2 bucket
    clear_r2_bucket()

    
    # Step 2: Move all PDFs from processed_folder back to watch_folder to reprocess
    print(f"[*] Moving PDFs from processed_folder back to watch_folder for reprocessing...")
    moved = 0
    for root, dirs, files in os.walk(PROCESSED_DIR):
        for filename in files:
            if filename.lower().endswith(".pdf"):
                src_pdf = os.path.join(root, filename)
                # Preserve subfolder structure relative to PROCESSED_DIR
                rel = os.path.relpath(root, PROCESSED_DIR)
                dest_dir = os.path.join(WATCH_DIR, rel) if rel != "." else WATCH_DIR
                os.makedirs(dest_dir, exist_ok=True)
                dest_pdf = os.path.join(dest_dir, filename)
                shutil.move(src_pdf, dest_pdf)
                print(f"    -> Moved: {os.path.relpath(src_pdf, PROCESSED_DIR)} -> watch_folder")
                moved += 1
                
                # Also move companion JSON if present
                base = os.path.splitext(filename)[0]
                src_json = os.path.join(root, f"{base}.json")
                if os.path.exists(src_json):
                    dest_json = os.path.join(dest_dir, f"{base}.json")
                    shutil.move(src_json, dest_json)
    
    print(f"[*] Moved {moved} PDF(s) back to watch_folder. Starting reprocess...")
    
    # Step 3: Process all PDFs now in watch_folder
    for root, dirs, files in os.walk(WATCH_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            if filename.lower().endswith(".pdf"):
                process_pdf(os.path.join(root, filename))
    
    print("\n[+] Re-upload complete!")


if __name__ == "__main__":
    print("==========================================================")
    print("        Cloudflare R2 Secure PDF Uploader (PyMuPDF)       ")
    print("==========================================================")
    
    # Check for --reupload flag: clear R2 and reprocess all PDFs from processed_folder
    if "--reupload" in sys.argv:
        reupload_all()
        exit(0)
    
    # Simple configuration check
    if not all([CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        print("[!] ERROR: Cloudflare R2 Credentials missing in local_uploader/.env file.")
        print("[!] Please open 'local_uploader/.env' and fill in your Cloudflare details.")
        exit(1)
        
    # Process any PDFs that are already in watch_folder recursively
    print(f"[*] Scanning watch folder recursively for PDFs to upload...")
    found_pdfs = []
    for root, dirs, files in os.walk(WATCH_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            if filename.lower().endswith(".pdf"):
                found_pdfs.append(os.path.join(root, filename))
    
    if not found_pdfs:
        print("[*] No PDFs found in the watch folder.")
    else:
        print(f"[*] Found {len(found_pdfs)} PDF(s) to process.")
        for pdf_path in found_pdfs:
            process_pdf(pdf_path)
            
    print("\n[+] Processing finished. Uploader script stopped.")
