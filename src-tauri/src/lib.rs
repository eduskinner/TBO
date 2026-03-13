use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use rayon::prelude::*;
use regex::Regex;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use image::GenericImageView;
use tauri::{AppHandle, Manager, State, Emitter};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

// ─────────────────────────────────────────────────────────────────────────────
//  Models
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Comic {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub title: String,
    pub series: String,
    pub issue_number: String,
    pub year: Option<i32>,
    pub publisher: String,
    pub writer: String,
    pub artist: String,
    pub genre: String,
    pub tags: String,
    pub read_status: String,
    pub rating: Option<i32>,
    pub notes: String,
    pub page_count: i32,
    pub current_page: i32,
    pub cover_cached: bool,
    pub date_added: String,
    pub file_size: i64,
    pub missing: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub added: i32,
    pub skipped: i32,
    pub errors: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  App State
// ─────────────────────────────────────────────────────────────────────────────

pub struct AppState {
    pub db: Mutex<Connection>,
    pub reader_comic_id: Mutex<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Database
// ─────────────────────────────────────────────────────────────────────────────

fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;
         PRAGMA cache_size=-8000;
         PRAGMA synchronous=NORMAL;

         CREATE TABLE IF NOT EXISTS comics (
             id           TEXT PRIMARY KEY,
             file_path    TEXT NOT NULL UNIQUE,
             file_name    TEXT NOT NULL,
             title        TEXT NOT NULL DEFAULT '',
             series       TEXT NOT NULL DEFAULT '',
             issue_number TEXT NOT NULL DEFAULT '',
             year         INTEGER,
             publisher    TEXT NOT NULL DEFAULT '',
             writer       TEXT NOT NULL DEFAULT '',
             artist       TEXT NOT NULL DEFAULT '',
             genre        TEXT NOT NULL DEFAULT '',
             tags         TEXT NOT NULL DEFAULT '',
             read_status  TEXT NOT NULL DEFAULT 'unread',
             rating       INTEGER,
             notes        TEXT NOT NULL DEFAULT '',
             page_count   INTEGER NOT NULL DEFAULT 0,
             current_page INTEGER NOT NULL DEFAULT 0,
             cover_cached INTEGER NOT NULL DEFAULT 0,
             date_added   TEXT NOT NULL,
             file_size    INTEGER NOT NULL DEFAULT 0,
             missing      INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE IF NOT EXISTS sources (
             id   TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             path TEXT NOT NULL UNIQUE
         );

         CREATE INDEX IF NOT EXISTS idx_comics_series       ON comics(series);
         CREATE INDEX IF NOT EXISTS idx_comics_cover_cached ON comics(cover_cached);
         CREATE INDEX IF NOT EXISTS idx_comics_read_status  ON comics(read_status);
         CREATE INDEX IF NOT EXISTS idx_comics_date_added   ON comics(date_added);
        ",
    )?;

    let has_missing: i32 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('comics') WHERE name='missing'",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    if has_missing == 0 {
        let _ = conn.execute("ALTER TABLE comics ADD COLUMN missing INTEGER NOT NULL DEFAULT 0", []);
    }

    Ok(())
}

fn row_to_comic(r: &rusqlite::Row) -> rusqlite::Result<Comic> {
    Ok(Comic {
        id:           r.get(0)?,
        file_path:    r.get(1)?,
        file_name:    r.get(2)?,
        title:        r.get(3)?,
        series:       r.get(4)?,
        issue_number: r.get(5)?,
        year:         r.get(6)?,
        publisher:    r.get(7)?,
        writer:       r.get(8)?,
        artist:       r.get(9)?,
        genre:        r.get(10)?,
        tags:         r.get(11)?,
        read_status:  r.get(12)?,
        rating:       r.get(13)?,
        notes:        r.get(14)?,
        page_count:   r.get(15)?,
        current_page: r.get(16)?,
        cover_cached: r.get::<_, i32>(17)? != 0,
        date_added:   r.get(18)?,
        file_size:    r.get(19)?,
        missing:      r.get::<_, i32>(20)? != 0,
    })
}

const SELECT_COLS: &str =
    "id,file_path,file_name,title,series,issue_number,year,publisher,\
     writer,artist,genre,tags,read_status,rating,notes,page_count,\
     current_page,cover_cached,date_added,file_size,missing";

// ─────────────────────────────────────────────────────────────────────────────
//  Filename Parser
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct ParsedFilename {
    title:        String,
    series:       String,
    issue_number: String,
    year:         Option<i32>,
    publisher:    String,
}

fn parse_filename(filename: &str) -> ParsedFilename {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    let clean = stem.replace(['_', '.'], " ");
    let mut result = ParsedFilename {
        title: clean.trim().to_string(),
        ..Default::default()
    };

    let issue_re = Regex::new(r"(?i)^(.+?)\s*[#]\s*(\d+)").unwrap();
    if let Some(caps) = issue_re.captures(stem) {
        result.series = caps[1].replace(['_', '.'], " ").trim().to_string();
        let raw_num = caps[2].to_string();
        let stripped = raw_num.trim_start_matches('0').to_string();
        result.issue_number = if stripped.is_empty() { "0".into() } else { stripped };
        result.title = format!("{} #{}", result.series, &caps[2]);
    }

    let year_re = Regex::new(r"\((\d{4})\)").unwrap();
    if let Some(caps) = year_re.captures(stem) {
        if let Ok(y) = caps[1].parse::<i32>() {
            if (1900..=2100).contains(&y) {
                result.year = Some(y);
            }
        }
    }

    let paren_re = Regex::new(r"\(([^)0-9][^)]*)\)").unwrap();
    if let Some(caps) = paren_re.captures_iter(stem).last() {
        let candidate = caps[1].trim().to_string();
        if candidate.len() > 1 {
            result.publisher = candidate;
        }
    }

    result
}

// ─────────────────────────────────────────────────────────────────────────────
//  Image helpers
// ─────────────────────────────────────────────────────────────────────────────

fn is_image(name: &str) -> bool {
    let l = name.to_lowercase();
    l.ends_with(".jpg") || l.ends_with(".jpeg") || l.ends_with(".png") ||
    l.ends_with(".gif") || l.ends_with(".webp") || l.ends_with(".bmp") ||
    l.ends_with(".tif") || l.ends_with(".tiff")
}

fn natural_sort_key(s: &str) -> String {
    let re = Regex::new(r"\d+").unwrap();
    re.replace_all(s, |caps: &regex::Captures| {
        format!("{:010}", caps[0].parse::<u64>().unwrap_or(0))
    })
    .to_lowercase()
}

fn bytes_to_data_url(bytes: &[u8]) -> String {
    let mime = if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(b"GIF") {
        "image/gif"
    } else if bytes.starts_with(b"%PDF") {
        "application/pdf"
    } else {
        "image/jpeg"
    };
    format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(bytes))
}

// ─────────────────────────────────────────────────────────────────────────────
//  CBZ (ZIP) archive helpers
// ─────────────────────────────────────────────────────────────────────────────

fn zip_image_list(path: &Path) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if is_image(&name) && !entry.is_dir() {
                names.push(name);
            }
        }
    }
    names.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    Ok(names)
}

fn zip_extract_page(path: &Path, files: &[String], idx: usize) -> Result<Vec<u8>, String> {
    if idx >= files.len() { return Err(format!("Page {} out of range", idx)); }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = archive.by_name(&files[idx]).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

// ─────────────────────────────────────────────────────────────────────────────
//  CBR (RAR) archive helpers
// ─────────────────────────────────────────────────────────────────────────────

fn is_zip_magic(path: &Path) -> bool {
    if let Ok(mut f) = fs::File::open(path) {
        use std::io::Read;
        let mut buf = [0u8; 4];
        if f.read_exact(&mut buf).is_ok() {
            return buf[0] == b'P' && buf[1] == b'K';
        }
    }
    false
}

fn is_rar_magic(path: &Path) -> bool {
    if let Ok(mut f) = fs::File::open(path) {
        use std::io::Read;
        let mut buf = [0u8; 7];
        if f.read_exact(&mut buf).is_ok() {
            return buf[0] == 0x52 && buf[1] == 0x61 && buf[2] == 0x72 &&
                   buf[3] == 0x21 && buf[4] == 0x1A && buf[5] == 0x07;
        }
    }
    false
}

#[cfg(not(target_os = "android"))]
fn unrar_crate_image_list(path: &Path) -> Result<Vec<String>, String> {
    let archive = unrar::Archive::new(path)
        .open_for_listing()
        .map_err(|e| format!("unrar open: {}", e))?;
    let mut names: Vec<String> = archive
        .filter_map(|e| e.ok())
        .map(|e| e.filename.to_string_lossy().into_owned())
        .filter(|n| is_image(n))
        .collect();
    names.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    if names.is_empty() {
        return Err("No images found in RAR archive".to_string());
    }
    Ok(names)
}

#[cfg(not(target_os = "android"))]
fn unrar_crate_extract_page(path: &Path, files: &[String], idx: usize) -> Result<Vec<u8>, String> {
    if idx >= files.len() { return Err(format!("Page {} out of range", idx)); }
    let target_name = &files[idx];
    let archive = unrar::Archive::new(path)
        .open_for_processing()
        .map_err(|e| format!("unrar open: {}", e))?;
    let mut cursor = archive;
    loop {
        let header = cursor.read_header().map_err(|e| format!("unrar header: {}", e))?;
        match header {
            None => break,
            Some(h) => {
                let entry_name = h.entry().filename.to_string_lossy().into_owned();
                if &entry_name == target_name {
                    let (data, _rest) = h.read().map_err(|e| format!("unrar read: {}", e))?;
                    return Ok(data);
                } else {
                    cursor = h.skip().map_err(|e| format!("unrar skip: {}", e))?;
                }
            }
        }
    }
    Err(format!("File not found in RAR: {}", target_name))
}

fn rar_run(cmds: &[(&str, &[&str])]) -> Result<std::process::Output, String> {
    let mut last_err = "No RAR tool available".to_string();
    for (bin, args) in cmds {
        match std::process::Command::new(bin).args(*args).output() {
            Ok(out) if out.status.success() => return Ok(out),
            Ok(out) => {
                last_err = format!(
                    "{} failed ({}): {}",
                    bin, out.status,
                    String::from_utf8_lossy(&out.stderr).trim()
                );
            }
            Err(_) => {}
        }
    }
    Err(last_err)
}

fn rar_tool_image_list(path: &Path) -> Result<Vec<String>, String> {
    let p = path.to_str().unwrap_or("");
    let out = rar_run(&[
        ("bsdtar", &["-tf", p]),
        ("unrar",  &["lb", p]),
        ("unar",   &["-list", p]),
    ])?;
    let raw = String::from_utf8_lossy(&out.stdout);
    let mut names: Vec<String> = raw
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim();
            if trimmed.is_empty() || trimmed.starts_with("---") || trimmed.starts_with("Archive") {
                return None;
            }
            let candidate = trimmed.split_whitespace().last().unwrap_or(trimmed);
            let clean = candidate.trim_start_matches("./");
            if is_image(clean) { Some(clean.to_string()) } else { None }
        })
        .collect();
    names.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    if names.is_empty() {
        return Err("No images found via external RAR tool".to_string());
    }
    Ok(names)
}

fn rar_tool_extract_page(path: &Path, files: &[String], idx: usize) -> Result<Vec<u8>, String> {
    if idx >= files.len() { return Err(format!("Page {} out of range", idx)); }
    let p = path.to_str().unwrap_or("");
    let target = files[idx].as_str();
    let out = rar_run(&[
        ("bsdtar", &["-xOf", p, target]),
        ("unrar",  &["p", "-inul", p, target]),
    ])?;
    if out.stdout.is_empty() {
        return Err("RAR tool returned empty output".to_string());
    }
    Ok(out.stdout)
}

fn cbr_image_list(path: &Path) -> Result<Vec<String>, String> {
    if is_zip_magic(path) {
        if let Ok(list) = zip_image_list(path) {
            if !list.is_empty() { return Ok(list); }
        }
    }

    #[cfg(not(target_os = "android"))]
    if is_rar_magic(path) {
        if let Ok(list) = unrar_crate_image_list(path) {
            return Ok(list);
        }
    }

    if let Ok(list) = zip_image_list(path) {
        if !list.is_empty() { return Ok(list); }
    }

    #[cfg(not(target_os = "android"))]
    return rar_tool_image_list(path);

    #[cfg(target_os = "android")]
    Err("RAR format not supported on Android — convert CBR to CBZ for best compatibility".to_string())
}

fn cbr_extract_page(path: &Path, files: &[String], idx: usize) -> Result<Vec<u8>, String> {
    if is_zip_magic(path) {
        if let Ok(bytes) = zip_extract_page(path, files, idx) {
            return Ok(bytes);
        }
    }

    #[cfg(not(target_os = "android"))]
    if is_rar_magic(path) {
        if let Ok(bytes) = unrar_crate_extract_page(path, files, idx) {
            return Ok(bytes);
        }
    }

    if let Ok(bytes) = zip_extract_page(path, files, idx) {
        return Ok(bytes);
    }

    #[cfg(not(target_os = "android"))]
    return rar_tool_extract_page(path, files, idx);

    #[cfg(target_os = "android")]
    Err("RAR format not supported on Android".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
//  PDF helpers
// ─────────────────────────────────────────────────────────────────────────────

fn pdf_page_list(path: &Path) -> Result<Vec<String>, String> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| format!("PDF load error: {}", e))?;
    let count = doc.get_pages().len();
    Ok((0..count).map(|i| format!("pdf_page_{}", i)).collect())
}

fn pdf_extract_jpeg(path: &Path, page_idx: usize) -> Option<Vec<u8>> {
    let doc = lopdf::Document::load(path).ok()?;
    let pages = doc.get_pages();
    let page_num = (page_idx + 1) as u32;
    let &page_id = pages.get(&page_num)?;
    extract_jpeg_from_page(&doc, page_id)
}

fn extract_jpeg_from_page(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> Option<Vec<u8>> {
    let page_obj  = doc.get_object(page_id).ok()?;
    let page_dict = page_obj.as_dict().ok()?;
    let res_obj   = page_dict.get(b"Resources").ok()?;
    let res_dict  = resolve_to_dict(doc, res_obj)?;
    let xobj_obj  = res_dict.get(b"XObject").ok()?;
    let xobj_dict = resolve_to_dict(doc, xobj_obj)?;

    for (_, obj) in xobj_dict.iter() {
        let xobj_id = if let lopdf::Object::Reference(id) = obj { *id } else { continue };
        if let Ok(lopdf::Object::Stream(stream)) = doc.get_object(xobj_id) {
            if !pdf_name_eq(stream.dict.get(b"Subtype").ok(), b"Image") { continue; }
            if pdf_name_eq(stream.dict.get(b"Filter").ok(), b"DCTDecode") {
                return Some(stream.content.clone());
            }
        }
    }
    None
}

fn resolve_to_dict<'a>(
    doc: &'a lopdf::Document,
    obj: &'a lopdf::Object,
) -> Option<&'a lopdf::Dictionary> {
    match obj {
        lopdf::Object::Dictionary(d) => Some(d),
        lopdf::Object::Reference(id) => doc.get_dictionary(*id).ok(),
        _ => None,
    }
}

fn pdf_name_eq(obj: Option<&lopdf::Object>, name: &[u8]) -> bool {
    if let Some(lopdf::Object::Name(n)) = obj { n.as_slice() == name } else { false }
}

fn pdf_extract_page_bytes(path: &Path, page_idx: usize) -> Result<Vec<u8>, String> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| format!("PDF load: {}", e))?;
    let pages = doc.get_pages();
    let page_num = (page_idx + 1) as u32;
    let &page_id = pages.get(&page_num)
        .ok_or_else(|| format!("PDF page {} not found", page_idx))?;

    if let Some(bytes) = extract_any_image_from_page(&doc, page_id) {
        return Ok(bytes);
    }

    Err(format!("Could not extract image from PDF page {}", page_idx))
}

fn extract_any_image_from_page(doc: &lopdf::Document, page_id: lopdf::ObjectId) -> Option<Vec<u8>> {
    let page_obj  = doc.get_object(page_id).ok()?;
    let page_dict = page_obj.as_dict().ok()?;
    let res_obj   = page_dict.get(b"Resources").ok()?;
    let res_dict  = resolve_to_dict(doc, res_obj)?;
    let xobj_obj  = res_dict.get(b"XObject").ok()?;
    let xobj_dict = resolve_to_dict(doc, xobj_obj)?;

    struct Candidate { area: u64, bytes: Vec<u8> }
    let mut best: Option<Candidate> = None;

    for (_, obj) in xobj_dict.iter() {
        let xobj_id = if let lopdf::Object::Reference(id) = obj { *id } else { continue };
        let stream = match doc.get_object(xobj_id) {
            Ok(lopdf::Object::Stream(s)) => s,
            _ => continue,
        };
        if !pdf_name_eq(stream.dict.get(b"Subtype").ok(), b"Image") { continue; }

        let width  = stream.dict.get(b"Width").ok()
            .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u64;
        let height = stream.dict.get(b"Height").ok()
            .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u64;
        let area = width * height;
        if area == 0 { continue; }

        if let Some(ref b) = best { if b.area >= area { continue; } }

        let filter = stream.dict.get(b"Filter").ok();

        if pdf_name_eq(filter, b"DCTDecode") {
            if !stream.content.is_empty() {
                best = Some(Candidate { area, bytes: stream.content.clone() });
            }
        } else if pdf_name_eq(filter, b"FlateDecode") {
            if let Ok(decompressed) = stream.decompressed_content() {
                let w = width as u32;
                let h = height as u32;
                let bits = stream.dict.get(b"BitsPerComponent").ok()
                    .and_then(|o| o.as_i64().ok()).unwrap_or(8) as u32;
                if w > 0 && h > 0 && bits == 8 {
                    let bpp = (decompressed.len() as u32).saturating_div(w * h);
                    let color_type = if bpp >= 3 { image::ColorType::Rgb8 } else { image::ColorType::L8 };
                    let mut buf = std::io::Cursor::new(Vec::new());
                    if image::codecs::png::PngEncoder::new(&mut buf)
                        .encode(&decompressed, w, h, color_type).is_ok()
                    {
                        best = Some(Candidate { area, bytes: buf.into_inner() });
                    }
                }
            }
        } else if pdf_name_eq(filter, b"JPXDecode") {
            if !stream.content.is_empty() {
                best = Some(Candidate { area, bytes: stream.content.clone() });
            }
        } else if stream.content.len() > 1024 {
            best = Some(Candidate { area, bytes: stream.content.clone() });
        }
    }

    best.map(|b| b.bytes)
}

fn pdf_placeholder_cover(cache_path: &Path, file_path: &str) -> Result<(), String> {
    if let Some(jpeg) = pdf_extract_jpeg(Path::new(file_path), 0) {
        if let Ok(img) = image::load_from_memory(&jpeg) {
            let thumb = img.thumbnail(140, 210);
            let mut buf = std::io::Cursor::new(Vec::new());
            thumb.write_to(&mut buf, image::ImageOutputFormat::Jpeg(65u8))
                .map_err(|e| e.to_string())?;
            return fs::write(cache_path, buf.into_inner()).map_err(|e| e.to_string());
        }
    }
    let img = image::DynamicImage::ImageRgb8(
        image::ImageBuffer::from_fn(140, 210, |_x, y| {
            let v = 45u8 + (y as u8 / 6).min(35);
            image::Rgb([v.saturating_sub(5), v.saturating_sub(5), v + 15])
        })
    );
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageOutputFormat::Jpeg(85u8))
        .map_err(|e| e.to_string())?;
    fs::write(cache_path, buf.into_inner()).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Unified dispatch
// ─────────────────────────────────────────────────────────────────────────────

fn image_list(path: &Path) -> Result<Vec<String>, String> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("cbz") => zip_image_list(path),
        Some("cbr") => cbr_image_list(path),
        Some("pdf") => pdf_page_list(path),
        _ => Err(format!("Unsupported format: {}", path.display())),
    }
}

fn extract_page_bytes(path: &Path, files: &[String], idx: usize) -> Result<Vec<u8>, String> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("cbz") => zip_extract_page(path, files, idx),
        Some("cbr") => cbr_extract_page(path, files, idx),
        Some("pdf") => pdf_extract_page_bytes(path, idx),
        _ => Err("Unsupported format".to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cover cache
// ─────────────────────────────────────────────────────────────────────────────

fn cover_cache_dir(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir()
        .unwrap_or_else(|_| dirs_data().join("cache"))
        .join("covers")
}

fn cover_cache_path(app: &AppHandle, id: &str) -> PathBuf {
    cover_cache_dir(app).join(format!("{}.jpg", id))
}

fn ensure_cover_at(cache_path: &Path, file_path: &str) -> Result<(), String> {
    if cache_path.exists() { return Ok(()); }
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let path = Path::new(file_path);

    if path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() == Some("pdf") {
        return pdf_placeholder_cover(cache_path, file_path);
    }

    let files = image_list(path)?;
    if files.is_empty() { return Err("No images in archive".to_string()); }
    let raw = extract_page_bytes(path, &files, 0)?;
    match image::load_from_memory(&raw) {
        Ok(img) => {
            let thumb = img.thumbnail(140, 210);
            let mut buf = std::io::Cursor::new(Vec::new());
            thumb.write_to(&mut buf, image::ImageOutputFormat::Jpeg(65u8))
                .map_err(|e| e.to_string())?;
            fs::write(cache_path, buf.into_inner()).map_err(|e| e.to_string())
        }
        Err(_) => fs::write(cache_path, &raw).map_err(|e| e.to_string()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Crash log commands (Android diagnostics)
// ─────────────────────────────────────────────────────────────────────────────

const CRASH_PATHS: &[&str] = &[
    "/data/data/com.lectortbo.reader/files/crash.txt",
    "/sdcard/lector-tbo-crash.txt",
];

#[tauri::command]
fn get_crash_log() -> String {
    for path in CRASH_PATHS {
        if let Ok(content) = fs::read_to_string(path) {
            if !content.is_empty() {
                return content;
            }
        }
    }
    String::new()
}

#[tauri::command]
fn clear_crash_log() {
    for path in CRASH_PATHS {
        let _ = fs::remove_file(path);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tauri Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_library(state: State<AppState>) -> Result<Vec<Comic>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {} FROM comics ORDER BY series ASC, CAST(issue_number AS INTEGER) ASC, title ASC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let comics: Vec<Comic> = stmt
        .query_map([], row_to_comic)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(comics)
}

fn scan_folder_impl(
    app: &AppHandle,
    state: &State<AppState>,
    folder_path: &str,
) -> Result<ScanResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut result = ScanResult { added: 0, skipped: 0, errors: vec![] };

    let entries: Vec<_> = WalkDir::new(folder_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file() && {
                let l = e.path().to_string_lossy().to_lowercase();
                l.ends_with(".cbz") || l.ends_with(".cbr") || l.ends_with(".pdf")
            }
        })
        .collect();

    let total = entries.len();
    let _ = app.emit("scan_progress", serde_json::json!({
        "found": total, "current": 0, "added": 0, "skipped": 0, "done": false
    }));

    for (i, entry) in entries.iter().enumerate() {
        let path  = entry.path();
        let fp    = path.to_string_lossy().to_string();
        let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let fsize = fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);

        let exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM comics WHERE file_path=?1",
            params![fp],
            |r| r.get::<_, i32>(0),
        ).map(|n| n > 0).unwrap_or(false);

        if exists {
            let _ = conn.execute(
                "UPDATE comics SET missing=0, file_size=?2 WHERE file_path=?1",
                params![fp, fsize],
            );
            result.skipped += 1;
        } else {
            let parsed = parse_filename(&fname);
            let title  = if parsed.title.is_empty() { fname.clone() } else { parsed.title };
            let id     = Uuid::new_v4().to_string();
            let now    = Utc::now().to_rfc3339();
            match conn.execute(
                "INSERT INTO comics \
                 (id,file_path,file_name,title,series,issue_number,year,publisher,\
                  page_count,date_added,file_size,missing) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,0)",
                params![
                    id, fp, fname, title,
                    parsed.series, parsed.issue_number, parsed.year, parsed.publisher,
                    now, fsize
                ],
            ) {
                Ok(_)  => result.added += 1,
                Err(e) => result.errors.push(format!("{}: {}", fname, e)),
            }
        }

        if i % 10 == 0 || i == total.saturating_sub(1) {
            let _ = app.emit("scan_progress", serde_json::json!({
                "found": total, "current": i + 1,
                "added": result.added, "skipped": result.skipped,
                "done": false, "file": fname
            }));
        }
    }

    let mut stmt = conn
        .prepare("SELECT id, file_path FROM comics WHERE file_path LIKE ?1")
        .map_err(|e| e.to_string())?;
    let folder_pattern = format!("{}%", folder_path);
    let rows = stmt
        .query_map(params![folder_pattern], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        if let Ok((id, fp)) = row {
            if !Path::new(&fp).exists() {
                let _ = conn.execute("UPDATE comics SET missing=1 WHERE id=?1", params![id]);
            } else {
                let _ = conn.execute("UPDATE comics SET missing=0 WHERE id=?1", params![id]);
            }
        }
    }

    let _ = conn.execute(
        "INSERT OR IGNORE INTO sources (id,name,path) VALUES (?1,?2,?3)",
        params![Uuid::new_v4().to_string(), folder_path, folder_path],
    );
    Ok(result)
}

#[tauri::command]
fn scan_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_path: String,
) -> Result<ScanResult, String> {
    let result = scan_folder_impl(&app, &state, &folder_path)?;
    let _ = app.emit("scan_progress", serde_json::json!({
        "found": result.added + result.skipped,
        "current": result.added + result.skipped,
        "added": result.added, "skipped": result.skipped, "done": true
    }));
    Ok(result)
}

#[tauri::command]
fn update_page_count(
    state: State<AppState>,
    comic_id: String,
    file_path: String,
) -> Result<i32, String> {
    let count = image_list(Path::new(&file_path))?.len() as i32;
    let conn  = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE comics SET page_count=?2 WHERE id=?1 AND page_count=0",
        params![comic_id, count],
    ).map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
async fn get_cover(
    app: AppHandle,
    state: State<'_, AppState>,
    comic_id: String,
    file_path: String,
) -> Result<String, String> {
    let cache = cover_cache_path(&app, &comic_id);
    if !cache.exists() {
        let fpath = file_path.clone();
        let c     = cache.clone();
        tauri::async_runtime::spawn_blocking(move || ensure_cover_at(&c, &fpath))
            .await
            .map_err(|e| e.to_string())??;
        if let Ok(conn) = state.db.lock() {
            let _ = conn.execute(
                "UPDATE comics SET cover_cached=1 WHERE id=?1",
                params![comic_id],
            );
        }
    }
    let bytes = fs::read(&cache).map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", general_purpose::STANDARD.encode(&bytes)))
}

#[tauri::command]
async fn get_page(file_path: String, page_index: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path  = Path::new(&file_path);
        let files = image_list(path)?;
        let bytes = extract_page_bytes(path, &files, page_index)?;
        Ok(bytes_to_data_url(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_page_count(file_path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(image_list(Path::new(&file_path))?.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_pdf_data_url(file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
        Ok(format!(
            "data:application/pdf;base64,{}",
            general_purpose::STANDARD.encode(&bytes)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_with_system(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoverRequest { pub comic_id: String, pub file_path: String }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoverResult { pub comic_id: String, pub data: Option<String> }

#[tauri::command]
async fn get_covers_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    comics: Vec<CoverRequest>,
) -> Result<Vec<CoverResult>, String> {
    let cache_dir = cover_cache_dir(&app);
    let items: Vec<(String, String, PathBuf)> = comics
        .into_iter()
        .map(|c| {
            let cp = cache_dir.join(format!("{}.jpg", c.comic_id));
            (c.comic_id, c.file_path, cp)
        })
        .collect();
    let items_clone = items.clone();

    let results: Vec<CoverResult> = tauri::async_runtime::spawn_blocking(move || {
        items_clone.into_par_iter().map(|(comic_id, file_path, cache_path)| {
            if !cache_path.exists() {
                if ensure_cover_at(&cache_path, &file_path).is_err() {
                    return CoverResult { comic_id, data: None };
                }
            }
            match fs::read(&cache_path) {
                Ok(bytes) => CoverResult {
                    comic_id,
                    data: Some(format!(
                        "data:image/jpeg;base64,{}",
                        general_purpose::STANDARD.encode(&bytes)
                    )),
                },
                Err(_) => CoverResult { comic_id, data: None },
            }
        }).collect()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Ok(conn) = state.db.lock() {
        for (comic_id, _, cache_path) in &items {
            if cache_path.exists() {
                let _ = conn.execute(
                    "UPDATE comics SET cover_cached=1 WHERE id=?1",
                    params![comic_id],
                );
            }
        }
    }
    Ok(results)
}

#[tauri::command]
async fn precache_all_covers(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let cache_dir = cover_cache_dir(&app);
    let raw_comics: Vec<(String, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM comics WHERE cover_cached=0")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let items: Vec<(String, String, PathBuf)> = raw_comics
        .into_iter()
        .map(|(id, fp)| {
            let cp = cache_dir.join(format!("{}.jpg", id));
            (id, fp, cp)
        })
        .collect();

    if items.is_empty() {
        let _ = app.emit("covers_precached", 0u32);
        return Ok(0);
    }

    let generated: Vec<String> = tauri::async_runtime::spawn_blocking(move || {
        items.par_iter().filter_map(|(comic_id, file_path, cache_path)| {
            if cache_path.exists() { return Some(comic_id.clone()); }
            if ensure_cover_at(cache_path, file_path).is_ok() { Some(comic_id.clone()) } else { None }
        }).collect()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Ok(conn) = state.db.lock() {
        if !generated.is_empty() {
            let placeholders = generated.iter().enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!("UPDATE comics SET cover_cached=1 WHERE id IN ({})", placeholders);
            let params: Vec<&dyn rusqlite::ToSql> = generated.iter()
                .map(|s| s as &dyn rusqlite::ToSql)
                .collect();
            let _ = conn.execute(&sql, params.as_slice());
        }
    }
    let _ = app.emit("covers_precached", generated.len() as u32);
    Ok(generated.len() as u32)
}

#[tauri::command]
fn update_comic(state: State<AppState>, comic: Comic) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE comics SET title=?2, series=?3, issue_number=?4, year=?5, publisher=?6, \
         writer=?7, artist=?8, genre=?9, tags=?10, notes=?11, rating=?12 WHERE id=?1",
        params![
            comic.id, comic.title, comic.series, comic.issue_number, comic.year,
            comic.publisher, comic.writer, comic.artist, comic.genre,
            comic.tags, comic.notes, comic.rating
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_read_status(
    state: State<AppState>,
    comic_id: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current: String = conn.query_row(
        "SELECT read_status FROM comics WHERE id=?1",
        params![comic_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let next = if current == "read" { "unread" } else { "read" };
    conn.execute(
        "UPDATE comics SET read_status=?2 WHERE id=?1",
        params![comic_id, next],
    ).map_err(|e| e.to_string())?;
    Ok(next.to_string())
}

#[tauri::command]
fn update_reading_progress(
    state: State<AppState>,
    comic_id: String,
    current_page: i32,
) -> Result<(), String> {
    let conn   = state.db.lock().map_err(|e| e.to_string())?;
    let status = if current_page > 0 { "reading" } else { "unread" };
    conn.execute(
        "UPDATE comics SET current_page=?2, read_status=?3 WHERE id=?1",
        params![comic_id, current_page, status],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_sources(state: State<AppState>) -> Result<Vec<Source>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, path FROM sources").map_err(|e| e.to_string())?;
    let sources: Vec<Source> = stmt
        .query_map([], |r| Ok(Source { id: r.get(0)?, name: r.get(1)?, path: r.get(2)? }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(sources)
}

#[tauri::command]
fn rescan_sources(
    app: AppHandle,
    state: State<AppState>,
) -> Result<ScanResult, String> {
    let sources = get_sources(state.clone())?;
    let mut total = ScanResult { added: 0, skipped: 0, errors: vec![] };
    for s in sources {
        let r = scan_folder_impl(&app, &state, &s.path)?;
        total.added   += r.added;
        total.skipped += r.skipped;
        total.errors.extend(r.errors);
    }
    Ok(total)
}

#[tauri::command]
fn remove_source(state: State<AppState>, source_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let path: String = conn.query_row(
        "SELECT path FROM sources WHERE id=?1",
        params![source_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sources WHERE id=?1", params![source_id])
        .map_err(|e| e.to_string())?;
    let pattern = format!("{}%", path);
    conn.execute("DELETE FROM comics WHERE file_path LIKE ?1", params![pattern])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_comic(state: State<AppState>, comic_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM comics WHERE id=?1", params![comic_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_folder_comics(state: State<AppState>, folder_path: String) -> Result<(), String> {
    let conn    = state.db.lock().map_err(|e| e.to_string())?;
    let pattern = format!("{}%", folder_path);
    conn.execute("DELETE FROM comics WHERE file_path LIKE ?1", params![pattern])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn search_comics(state: State<AppState>, query: String) -> Result<Vec<Comic>, String> {
    let conn    = state.db.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query.to_lowercase());
    let sql     = format!(
        "SELECT {} FROM comics \
         WHERE title LIKE ?1 OR series LIKE ?1 OR file_name LIKE ?1 \
         ORDER BY series ASC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let comics = stmt
        .query_map(params![pattern], row_to_comic)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(comics)
}

#[tauri::command]
fn clear_library(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM comics", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sources", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_reader_window(
    app: AppHandle,
    state: State<AppState>,
    comic_id: String,
) -> Result<(), String> {
    {
        let mut id = state.reader_comic_id.lock().map_err(|e| e.to_string())?;
        *id = comic_id;
    }
    if let Some(win) = app.get_webview_window("reader") {
        #[cfg(desktop)]
        let _ = win.set_focus();
        win.emit("reload_comic", ()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let builder = tauri::webview::WebviewWindowBuilder::new(
        &app,
        "reader",
        tauri::WebviewUrl::App("index.html#reader".into()),
    );
    #[cfg(desktop)]
    let builder = builder.title("Lector TBO - Reader").inner_size(1200.0, 800.0);
    builder.build().map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_reader_comic_id(state: State<AppState>) -> Result<String, String> {
    let id = state.reader_comic_id.lock().map_err(|e| e.to_string())?;
    Ok(id.clone())
}

#[tauri::command]
fn get_comic(state: State<AppState>, comic_id: String) -> Result<Comic, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let sql  = format!("SELECT {} FROM comics WHERE id=?1", SELECT_COLS);
    conn.query_row(&sql, params![comic_id], row_to_comic)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PanelRect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }

#[tauri::command]
async fn get_page_panels(
    file_path: String,
    page_index: usize,
) -> Result<Vec<PanelRect>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path  = Path::new(&file_path);
        if path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() == Some("pdf") {
            return Ok(vec![]);
        }
        let files = image_list(path)?;
        let bytes = extract_page_bytes(path, &files, page_index)?;
        let img   = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
        let (orig_w, orig_h) = img.dimensions();
        let scale = if orig_w > 1200 { 1200.0 / orig_w as f32 } else { 1.0 };
        let w = (orig_w as f32 * scale) as u32;
        let h = (orig_h as f32 * scale) as u32;
        let thumb = img.thumbnail_exact(w, h);
        let mut ink_map = vec![false; (w * h) as usize];
        let luma = thumb.to_luma8();
        for y in 0..h {
            for x in 0..w {
                let p = luma.get_pixel(x, y)[0];
                if p < 240 { ink_map[(y * w + x) as usize] = true; }
            }
        }
        fn decompose(ix: u32, iy: u32, w: u32, h: u32, ink_map: &[bool], full_w: u32, depth: u32) -> Vec<(u32, u32, u32, u32)> {
            if depth > 10 || w < 50 || h < 50 { return vec![(ix, iy, ix + w, iy + h)]; }
            let mut v_profile = vec![0u32; w as usize];
            for x in 0..w { for y in 0..h { if ink_map[((iy + y) * full_w + (ix + x)) as usize] { v_profile[x as usize] += 1; } } }
            let v_gutter_limit = (h as f32 * 0.01) as u32;
            let mut cuts = Vec::new();
            let mut in_cut = false;
            let mut start = 0;
            for x in 0..w {
                if v_profile[x as usize] <= v_gutter_limit { if !in_cut { start = x; in_cut = true; } }
                else { if in_cut { cuts.push((start, x)); in_cut = false; } }
            }
            if in_cut { cuts.push((start, w)); }
            let valid_cuts: Vec<_> = cuts.into_iter().filter(|(s, e)| e - s > (w / 40)).collect();
            if !valid_cuts.is_empty() {
                let mut best_cut = valid_cuts[0];
                let mut max_w = best_cut.1 - best_cut.0;
                for c in &valid_cuts { if c.1 - c.0 > max_w { max_w = c.1 - c.0; best_cut = *c; } }
                if max_w > 2 {
                    let mut left = decompose(ix, iy, best_cut.0, h, ink_map, full_w, depth + 1);
                    let right = decompose(ix + best_cut.1, iy, w - best_cut.1, h, ink_map, full_w, depth + 1);
                    left.extend(right);
                    return left;
                }
            }
            let mut h_profile = vec![0u32; h as usize];
            for y in 0..h { for x in 0..w { if ink_map[((iy + y) * full_w + (ix + x)) as usize] { h_profile[y as usize] += 1; } } }
            let h_gutter_limit = (w as f32 * 0.01) as u32;
            let mut cuts = Vec::new();
            let mut in_cut = false;
            let mut start = 0;
            for y in 0..h {
                if h_profile[y as usize] <= h_gutter_limit { if !in_cut { start = y; in_cut = true; } }
                else { if in_cut { cuts.push((start, y)); in_cut = false; } }
            }
            if in_cut { cuts.push((start, h)); }
            let valid_cuts: Vec<_> = cuts.into_iter().filter(|(s, e)| e - s > (h / 40)).collect();
            if !valid_cuts.is_empty() {
                let mut best_cut = valid_cuts[0];
                let mut max_h = best_cut.1 - best_cut.0;
                for c in &valid_cuts { if c.1 - c.0 > max_h { max_h = c.1 - c.0; best_cut = *c; } }
                if max_h > 2 {
                    let mut top = decompose(ix, iy, w, best_cut.0, ink_map, full_w, depth + 1);
                    let bottom = decompose(ix, iy + best_cut.1, w, h - best_cut.1, ink_map, full_w, depth + 1);
                    top.extend(bottom);
                    return top;
                }
            }
            let mut r_min_x = 0; while r_min_x < w && v_profile[r_min_x as usize] <= v_gutter_limit { r_min_x += 1; }
            let mut r_max_x = w - 1; while r_max_x > r_min_x && v_profile[r_max_x as usize] <= v_gutter_limit { r_max_x -= 1; }
            let mut r_min_y = 0; while r_min_y < h && h_profile[r_min_y as usize] <= h_gutter_limit { r_min_y += 1; }
            let mut r_max_y = h - 1; while r_max_y > r_min_y && h_profile[r_max_y as usize] <= h_gutter_limit { r_max_y -= 1; }
            vec![(ix + r_min_x, iy + r_min_y, ix + r_max_x, iy + r_max_y)]
        }
        let boxes = decompose(0, 0, w, h, &ink_map, w, 0);
        let row_thresh = h / 12;
        let mut sorted_boxes = boxes.clone();
        sorted_boxes.sort_by(|a, b| {
            let dy = (a.1 as i32 - b.1 as i32).abs();
            if dy < row_thresh as i32 { a.0.cmp(&b.0) } else { a.1.cmp(&b.1) }
        });
        let mut final_rects = Vec::new();
        if sorted_boxes.is_empty() {
            final_rects.push(PanelRect { x: 0.0, y: 0.0, w: orig_w as f32, h: orig_h as f32 });
        } else {
            for b in sorted_boxes {
                let bw = b.2 - b.0; let bh = b.3 - b.1;
                if bw < 50 || bh < 50 { continue; }
                let pw = (bw as f32 * 0.04) as u32; let ph = (bh as f32 * 0.04) as u32;
                final_rects.push(PanelRect {
                    x: b.0.saturating_sub(pw) as f32 / scale,
                    y: b.1.saturating_sub(ph) as f32 / scale,
                    w: (bw + pw * 2) as f32 / scale,
                    h: (bh + ph * 2) as f32 / scale,
                });
            }
        }
        Ok(final_rects)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn clear_missing_comics(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM comics WHERE missing=1", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────────────────

fn dirs_data() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".local")
        .join("share")
        .join("lector-tbo")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install panic hook before anything else so crashes are visible on Android.
    // Writes to the app's private files dir; App.tsx reads it on next launch
    // and displays it on screen instead of silently closing.
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("CRASH: {}\n", info);
        let paths = [
            "/data/data/com.lectortbo.reader/files/crash.txt",
            "/sdcard/lector-tbo-crash.txt",
        ];
        for path in &paths {
            if let Ok(mut f) = fs::File::create(path) {
                use std::io::Write;
                let _ = f.write_all(msg.as_bytes());
                break;
            }
        }
    }));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_dialog::init());
    }

    builder.setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("panels.db");
            let conn    = Connection::open(&db_path)?;
            init_db(&conn)?;
            app.manage(AppState {
                db: Mutex::new(conn),
                reader_comic_id: Mutex::new(String::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library, scan_folder, rescan_sources, update_page_count,
            get_cover, get_covers_batch, precache_all_covers,
            get_page, get_page_count, get_pdf_data_url, open_with_system,
            update_comic, toggle_read_status, update_reading_progress,
            get_sources, remove_source, delete_comic, search_comics,
            clear_library, open_reader_window, get_reader_comic_id, get_comic,
            get_page_panels, clear_missing_comics, delete_folder_comics,
            get_crash_log, clear_crash_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
