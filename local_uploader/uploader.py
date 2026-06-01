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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

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
    
    # 1. Parse Subject Name from relative directory structure
    rel_path = os.path.relpath(pdf_path, WATCH_DIR)
    parts = rel_path.split(os.sep)
    
    if len(parts) >= 2:
        # PDF is in a subject subfolder (e.g. watch_folder/Maths/lecture1.pdf)
        subject_name = parts[0]
        filename = parts[-1]
        doc_name, ext = os.path.splitext(filename)
    else:
        # PDF is directly in watch_folder
        subject_name = "General"
        filename = parts[0]
        doc_name, ext = os.path.splitext(filename)

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

    # Form unique document identifier for R2 to prevent conflicts across subjects
    r2_doc_id = f"{subject_name} - {doc_name}"
    print(f"[*] Processing document as R2 ID: '{r2_doc_id}'")
    
    try:
        # 2. Handle Companion JSON Metadata
        json_path = os.path.join(os.path.dirname(pdf_path), f"{doc_name}.json")
        metadata = None
        has_custom_json = False
        
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                has_custom_json = True
                print(f"[+] Found custom companion JSON: '{os.path.basename(json_path)}'")
            except Exception as e:
                print(f"[!] Error reading custom JSON, will generate default: {e}")
                metadata = None

        if metadata is None:
            # Generate AdSense-compliant default metadata template
            date_str = datetime.date.today().strftime("%B %d, %Y")
            
            metadata = {
                "title": doc_name,
                "subject": subject_name,
                "gradeLevel": "High School / College",
                "datePublished": date_str,
                "targetAudience": f"Students studying {doc_name} under the {subject_name} curriculum who want a comprehensive overview and practice questions.",
                "summary": f"This study guide covers key topics from the {subject_name} notes '{doc_name}'. It provides a thorough abstract of the central curriculum elements, helping students review important formulas, conceptual diagrams, and theoretical models. Reading this material will clarify complex topics, detail common classroom homework questions, and serve as an excellent study reference for midterms and final exams in {subject_name}.",
                "keyConcepts": [
                  f"Master the core definitions and vocabulary of {doc_name} in {subject_name}.",
                  "Learn to solve standard practice questions and application exercises.",
                  "Analyze the relationship between theoretical concepts and step-by-step proofs."
                ],
                "sections": [
                  { "title": "Section 1: Introduction and Core Definitions", "pages": "Pages 1-2", "description": f"Introduction to basic {subject_name} principles and vocabulary." },
                  { "title": "Section 2: Key Methodology and Theory", "pages": "Pages 3-5", "description": "Deep-dive analysis of formulas, equations, or structural details." },
                  { "title": "Section 3: Practical Applications and Review", "pages": "Pages 6+", "description": "Practice problems and step-by-step mathematical examples." }
                ],
                "quiz": [
                  {
                    "question": f"What is the main topic covered in the '{doc_name}' study guide for {subject_name}?",
                    "options": [
                      "An introduction and analysis of the core lecture themes",
                      "Unrelated historical facts",
                      "Programming in an unrelated language",
                      "General school guidelines"
                    ],
                    "answerIndex": 0,
                    "explanation": f"The main focus of this document is to analyze and review the core themes of '{doc_name}' within {subject_name}."
                  },
                  {
                    "question": "What is the recommended approach to master the learning objectives of this lecture?",
                    "options": [
                      "Memorizing the summary without studying the visual notes",
                      "Reviewing the concepts sequentially, tracing the formulas, and answering the practice questions",
                      "Printing the document pages to share offline",
                      "Skipping the interactive quiz"
                    ],
                    "answerIndex": 1,
                    "explanation": "Active recall by going through the study breakdown and answering practice questions is the most effective approach."
                  },
                  {
                    "question": "How are the practice examples in Section 3 structured?",
                    "options": [
                      "They are left as exercises without solutions",
                      "They feature detailed, step-by-step applications of the theories",
                      "They are multiple-choice questions only",
                      "They are omitted from the text breakdown"
                    ],
                    "answerIndex": 1,
                    "explanation": "Section 3 features detailed, step-by-step applications of the core lecture theories to support learning."
                  }
                ]
            }
            
            # Save the template JSON locally in the subject watch folder so the user can see and modify it
            try:
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, indent=2)
                print(f"[+] Generated default companion JSON metadata template: '{os.path.basename(json_path)}'")
            except Exception as e:
                print(f"[!] Warning: Could not write local template JSON: {e}")

        # 3. Upload images and metadata to R2 under the unique key prefix
        # Upload the metadata JSON file to R2
        metadata_key = f"{r2_doc_id}/metadata.json"
        metadata_json_bytes = json.dumps(metadata, indent=2).encode('utf-8')
        upload_to_r2(metadata_key, metadata_json_bytes, "application/json")
        print(f"[+] Uploaded metadata JSON to R2: '{metadata_key}'")

        # Open PDF using PyMuPDF
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        print(f"[*] Found {total_pages} pages in document.")
        
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
        
        # 4. Move files to a structured processed subfolder by subject
        dest_subfolder = os.path.join(PROCESSED_DIR, subject_name) if subject_name != "General" else PROCESSED_DIR
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

class PDFHandler(FileSystemEventHandler):
    """Watches for file creation events inside the watch_folder recursively."""
    def on_created(self, event):
        if not event.is_directory and os.path.normpath(event.src_path).lower().endswith(".pdf"):
            process_pdf(event.src_path)

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
    print("     Cloudflare R2 Secure PDF Auto-Uploader (PyMuPDF)     ")
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
        
    # Process any PDFs that are already in watch_folder on startup recursively
    print(f"[*] Scanning watch folder recursively for any existing PDFs...")
    for root, dirs, files in os.walk(WATCH_DIR):
        if ".venv" in root or ".git" in root:
            continue
        for filename in files:
            if filename.lower().endswith(".pdf"):
                process_pdf(os.path.join(root, filename))
            
    print(f"[*] Starting folder watcher recursively on: '{WATCH_DIR}'")
    event_handler = PDFHandler()
    observer = Observer()
    observer.schedule(event_handler, WATCH_DIR, recursive=True)
    observer.start()
    
    print("[*] Active. Drop PDF files into 'watch_folder' subdirectories to upload them.")
    print("[*] Press Ctrl+C to exit.")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] Stopping folder watcher...")
        observer.stop()
    observer.join()
    print("[*] Uploader script stopped.")
