import os
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
import pandas as pd
import pmo_weekly_report
import pdfplumber
import re

PORT = int(os.environ.get("PORT", 8000))
EXCEL_PATH = "PMO_Weekly_Report_Data.xlsx"

# ---------------------------------------------------------------------------
# PDF GANTT SCHEDULE PARSER
# ---------------------------------------------------------------------------
def clean_cell(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text.strip())

def parse_pdf_plan_with_hierarchy(path):
    with pdfplumber.open(path) as pdf:
        tasks = []
        left_pages = [0, 1, 2, 3]
        right_pages = [4, 5, 6, 7]
        
        for idx in range(4):
            if idx >= len(pdf.pages):
                break
            lp = pdf.pages[left_pages[idx]]
            
            # Use right page mapping if available, otherwise fallback
            rp_idx = right_pages[idx]
            if rp_idx < len(pdf.pages):
                rp = pdf.pages[rp_idx]
                r_tables = rp.extract_tables()
            else:
                r_tables = []
                
            l_tables = lp.extract_tables()
            
            if not l_tables:
                continue
                
            l_rows = l_tables[0]
            r_rows = r_tables[0] if r_tables else []
            
            words = lp.extract_words()
            
            for r_idx in range(1, len(l_rows)):
                l_row = l_rows[r_idx]
                r_row = r_rows[r_idx] if r_idx < len(r_rows) else [""] * 8
                
                tid = clean_cell(l_row[0])
                if not tid:
                    continue
                    
                name = clean_cell(l_row[3])
                
                # Check coordinates of first word
                first_word = re.findall(r'[A-Za-z0-9\-]+', name)
                x0_val = 161.7  # fallback to level 3
                
                if first_word:
                    target_word = first_word[0].lower()
                    matching_words = [w for w in words if w["text"].lower().startswith(target_word) and 100 < w["x0"] < 250]
                    if matching_words:
                        estimated_top = 50 + r_idx * 15.6
                        matching_words.sort(key=lambda w: abs(w["top"] - estimated_top))
                        x0_val = matching_words[0]["x0"]
                
                # Deduce hierarchy level using the baseline-offset math formula
                level = int(round((x0_val - 139.1) / 11.25)) + 1
                if level < 1:
                    level = 1
                    
                task = {
                    "id": int(tid),
                    "name": name,
                    "duration": clean_cell(l_row[4]),
                    "baselineStart": clean_cell(l_row[5]),
                    "baselineFinish": clean_cell(l_row[6]),
                    "start": clean_cell(l_row[7]),
                    "finish": clean_cell(r_row[0]) if len(r_row) > 0 else "",
                    "percentComplete": clean_cell(r_row[1]) if len(r_row) > 1 else "",
                    "progressPercent": clean_cell(r_row[2]) if len(r_row) > 2 else "",
                    "resources": clean_cell(r_row[3]) if len(r_row) > 3 else "",
                    "predecessors": clean_cell(r_row[4]) if len(r_row) > 4 else "",
                    "comments": clean_cell(r_row[5]) if len(r_row) > 5 else "",
                    "deliverable": clean_cell(r_row[6]) if len(r_row) > 6 else "",
                    "level": level
                }
                tasks.append(task)
                
        tasks.sort(key=lambda x: x["id"])
        
        project_name = "Freedom Telecom"
        if tasks:
            project_name = tasks[0]["name"]
            
        return {
            "projectName": project_name,
            "tasks": tasks
        }


class PMORequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence default logging to keep terminal output clean
        pass

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path

        # Route: API Data Retrieval
        if path == "/api/data":
            if not os.path.exists(EXCEL_PATH):
                self.send_error_response(404, f"Excel file {EXCEL_PATH} not found.")
                return

            try:
                # Read all sheets
                excel_file = pd.ExcelFile(EXCEL_PATH)
                df_projects = pd.read_excel(excel_file, sheet_name="Projects")
                if "Approved By" not in df_projects.columns:
                    df_projects["Approved By"] = None
                
                # Treat NaN in Approved By as None for JSON serialization
                df_projects["Approved By"] = df_projects["Approved By"].astype(object).where(df_projects["Approved By"].notnull(), None)

                data = {
                    "projects": df_projects.to_dict(orient="records"),
                    "achievements": pd.read_excel(excel_file, sheet_name="Achievements").to_dict(orient="records"),
                    "risks": pd.read_excel(excel_file, sheet_name="Risks").to_dict(orient="records"),
                    "nextsteps": pd.read_excel(excel_file, sheet_name="NextSteps").to_dict(orient="records"),
                    "decisions": pd.read_excel(excel_file, sheet_name="Decisions").to_dict(orient="records")
                }
                
                # Fetch latest approval metadata if sheet exists
                data["latestApproval"] = None
                if "Approvals" in excel_file.sheet_names:
                    df_approvals = pd.read_excel(excel_file, sheet_name="Approvals")
                    if not df_approvals.empty:
                        last_row = df_approvals.iloc[-1].to_dict()
                        if "Timestamp" in last_row and pd.notnull(last_row["Timestamp"]):
                            last_row["Timestamp"] = str(last_row["Timestamp"])
                        data["latestApproval"] = last_row
                
                # Format dates in NextSteps to strings for JSON safety
                for item in data["nextsteps"]:
                    if "Deadline" in item and pd.notnull(item["Deadline"]):
                        if isinstance(item["Deadline"], pd.Timestamp) or hasattr(item["Deadline"], "strftime"):
                            item["Deadline"] = item["Deadline"].strftime("%Y-%m-%d")
                        else:
                            item["Deadline"] = str(item["Deadline"])
                            
                self.send_json_response(200, data)
            except Exception as e:
                self.send_error_response(500, f"Error reading Excel data: {str(e)}")
            return

        elif path == "/api/plan/data":
            plan_path = "project_plan.json"
            if not os.path.exists(plan_path):
                self.send_json_response(200, {"projectName": "", "tasks": []})
                return
            try:
                with open(plan_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(200, data)
            except Exception as e:
                self.send_error_response(500, f"Error reading plan: {str(e)}")
            return

        # Route: Static File Serving
        # Map URL path to local file path
        if path == "/" or path == "/index.html":
            local_file = "index.html"
            content_type = "text/html"
            is_binary = False
        elif path == "/styles.css":
            local_file = "styles.css"
            content_type = "text/css"
            is_binary = False
        elif path == "/app.js":
            local_file = "app.js"
            content_type = "application/javascript"
            is_binary = False
        elif path == "/logo.png":
            local_file = "logo.png"
            content_type = "image/png"
            is_binary = True
        elif path == "/api/download/docx":
            local_file = "PMO_Executive_Report.docx"
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            is_binary = True
        elif path == "/api/download/excel":
            local_file = EXCEL_PATH
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            is_binary = True
        else:
            self.send_error_response(404, "File not found.")
            return

        # Check if static file exists and serve it
        if os.path.exists(local_file):
            try:
                if is_binary:
                    with open(local_file, "rb") as f:
                        content = f.read()
                else:
                    with open(local_file, "r", encoding="utf-8") as f:
                        content = f.read().encode('utf-8')
                        
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                # Disable caching for instant updates
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                # Add download header for API download routes
                if path.startswith("/api/download/"):
                    filename = os.path.basename(local_file)
                    self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_error_response(500, f"Error serving file: {str(e)}")
        else:
            self.send_error_response(404, f"File {local_file} not found.")

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path

        # Route: Submit Data from Web UI
        if path == "/api/submit":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))

                # Validate data structure
                required_keys = ["projects", "achievements", "risks", "nextsteps", "decisions"]
                if not all(k in payload for k in required_keys):
                    self.send_error_response(400, "Invalid payload. Missing sheet datasets.")
                    return

                # Convert lists of dicts into DataFrames
                df_projects = pd.DataFrame(payload["projects"])
                df_achievements = pd.DataFrame(payload["achievements"])
                df_risks = pd.DataFrame(payload["risks"])
                df_nextsteps = pd.DataFrame(payload["nextsteps"])
                df_decisions = pd.DataFrame(payload["decisions"])

                # Ensure columns match expected schemas precisely
                # Projects
                p_cols = ["Project", "Manager", "Planned %", "Actual %", "Budget", "Actual Cost", "Delay Days", "Risk Score", "Approved By"]
                for col in p_cols:
                    if col not in df_projects.columns:
                        df_projects[col] = None
                df_projects = df_projects[p_cols]

                # Achievements
                a_cols = ["Project", "Achievement"]
                for col in a_cols:
                    if col not in df_achievements.columns:
                        df_achievements[col] = None
                df_achievements = df_achievements[a_cols]

                # Risks
                r_cols = ["Project", "Risk Description", "Probability", "Impact", "Mitigation"]
                for col in r_cols:
                    if col not in df_risks.columns:
                        df_risks[col] = None
                df_risks = df_risks[r_cols]

                # NextSteps
                n_cols = ["Project", "Task", "Owner", "Deadline"]
                for col in n_cols:
                    if col not in df_nextsteps.columns:
                        df_nextsteps[col] = None
                df_nextsteps = df_nextsteps[n_cols]

                # Decisions
                d_cols = ["Project", "Decision Required", "Context", "Options", "Recommendation"]
                for col in d_cols:
                    if col not in df_decisions.columns:
                        df_decisions[col] = None
                df_decisions = df_decisions[d_cols]

                # Logging approval history
                approved_by = payload.get("approvedBy", "Project Lead")
                approved_projs_list = payload.get("approvedProjects", [])
                approved_projs_str = ", ".join(approved_projs_list) if approved_projs_list else ""
                
                # Check if Approvals sheet already exists
                df_approvals = pd.DataFrame(columns=["Timestamp", "Approved By", "Approved Projects"])
                if os.path.exists(EXCEL_PATH):
                    try:
                        excel_file = pd.ExcelFile(EXCEL_PATH)
                        if "Approvals" in excel_file.sheet_names:
                            df_approvals = pd.read_excel(excel_file, sheet_name="Approvals")
                    except Exception as e:
                        print(f"Error reading approvals log: {e}")
                
                # Create a new log row
                from datetime import datetime
                new_row = {
                    "Timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "Approved By": approved_by,
                    "Approved Projects": approved_projs_str
                }
                
                # Append row
                df_approvals = pd.concat([df_approvals, pd.DataFrame([new_row])], ignore_index=True)

                # Write to Excel sheets
                with pd.ExcelWriter(EXCEL_PATH, engine="openpyxl") as writer:
                    df_projects.to_excel(writer, sheet_name="Projects", index=False)
                    df_achievements.to_excel(writer, sheet_name="Achievements", index=False)
                    df_risks.to_excel(writer, sheet_name="Risks", index=False)
                    df_nextsteps.to_excel(writer, sheet_name="NextSteps", index=False)
                    df_decisions.to_excel(writer, sheet_name="Decisions", index=False)
                    df_approvals.to_excel(writer, sheet_name="Approvals", index=False)

                print(f"Excel data updated (Approved By: {approved_by}). Running report generation...")

                # Regenerate Word report
                pmo_weekly_report.run_report_generation(approved_by=approved_by)

                # Send success response
                response_data = {
                    "status": "success",
                    "message": "Project data successfully synced with Excel and Word report generated."
                }
                self.send_json_response(200, response_data)

            except Exception as e:
                import traceback
                print(f"Error during submit: {e}")
                traceback.print_exc()
                self.send_error_response(500, f"Error processing submission: {str(e)}")
            return

        elif path == "/api/plan/upload":
            try:
                content_type = self.headers.get('Content-Type', '')
                if not content_type.startswith('multipart/form-data'):
                    self.send_error_response(400, "Content-Type must be multipart/form-data")
                    return
                
                # Extract boundary
                boundary = content_type.split("boundary=")[1].encode()
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                
                # Split body by boundary to find the file
                parts = body.split(b"--" + boundary)
                file_data = None
                for part in parts:
                    if b"filename=" in part:
                        # Find end of headers
                        header_end = part.find(b"\r\n\r\n")
                        if header_end != -1:
                            # File content is between headers end and the trailing \r\n
                            file_data = part[header_end+4:-2]
                            break
                
                if not file_data:
                    self.send_error_response(400, "No file uploaded")
                    return
                
                # Save the temporary file
                temp_pdf_path = "temp_plan.pdf"
                with open(temp_pdf_path, "wb") as f:
                    f.write(file_data)
                
                # Parse using pdfplumber helper
                plan_data = parse_pdf_plan_with_hierarchy(temp_pdf_path)
                
                # Save to project_plan.json
                with open("project_plan.json", "w", encoding="utf-8") as f:
                    json.dump(plan_data, f, indent=2)
                
                # Delete temp PDF
                if os.path.exists(temp_pdf_path):
                    os.remove(temp_pdf_path)
                
                self.send_json_response(200, {
                    "status": "success",
                    "message": f"Successfully parsed {len(plan_data['tasks'])} tasks.",
                    "projectName": plan_data["projectName"],
                    "tasks": plan_data["tasks"]
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_response(500, f"Error parsing PDF: {str(e)}")
            return

        elif path == "/api/plan/save":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                plan_data = json.loads(post_data.decode('utf-8'))
                
                # Write to project_plan.json
                with open("project_plan.json", "w", encoding="utf-8") as f:
                    json.dump(plan_data, f, indent=2)
                
                self.send_json_response(200, {
                    "status": "success",
                    "message": "Project plan updates saved permanently on server."
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_response(500, f"Error saving project plan: {str(e)}")
            return

        elif path == "/api/approve":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))

                project_name = payload.get("project")
                approved_by = payload.get("approvedBy")  # string or null

                if not project_name:
                    self.send_error_response(400, "Missing project name.")
                    return

                if not os.path.exists(EXCEL_PATH):
                    self.send_error_response(404, f"Excel file {EXCEL_PATH} not found.")
                    return

                # Read all sheets to preserve them
                excel_file = pd.ExcelFile(EXCEL_PATH)
                sheets = {}
                for sheet in excel_file.sheet_names:
                    sheets[sheet] = pd.read_excel(excel_file, sheet_name=sheet)

                df_projects = sheets["Projects"]
                
                # Check if "Approved By" column exists, if not add it
                if "Approved By" not in df_projects.columns:
                    df_projects["Approved By"] = None

                # Find project and update
                idx_list = df_projects.index[df_projects["Project"] == project_name].tolist()
                if not idx_list:
                    self.send_error_response(404, f"Project '{project_name}' not found.")
                    return
                
                df_projects.at[idx_list[0], "Approved By"] = approved_by

                # Write all sheets back
                with pd.ExcelWriter(EXCEL_PATH, engine="openpyxl") as writer:
                    for sheet_name, df_sheet in sheets.items():
                        df_sheet.to_excel(writer, sheet_name=sheet_name, index=False)

                self.send_json_response(200, {
                    "status": "success",
                    "message": f"Project approval status updated for {project_name}."
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_response(500, f"Error processing approval: {str(e)}")
            return

        elif path == "/api/approve/bulk":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))

                approvals = payload.get("approvals")  # dict of project_name: approvedBy (or None)

                if approvals is None or not isinstance(approvals, dict):
                    self.send_error_response(400, "Missing approvals mapping.")
                    return

                if not os.path.exists(EXCEL_PATH):
                    self.send_error_response(404, f"Excel file {EXCEL_PATH} not found.")
                    return

                # Read all sheets
                excel_file = pd.ExcelFile(EXCEL_PATH)
                sheets = {}
                for sheet in excel_file.sheet_names:
                    sheets[sheet] = pd.read_excel(excel_file, sheet_name=sheet)

                df_projects = sheets["Projects"]
                
                if "Approved By" not in df_projects.columns:
                    df_projects["Approved By"] = None

                for proj_name, approved_by in approvals.items():
                    idx_list = df_projects.index[df_projects["Project"] == proj_name].tolist()
                    if idx_list:
                        df_projects.at[idx_list[0], "Approved By"] = approved_by

                # Write all sheets back
                with pd.ExcelWriter(EXCEL_PATH, engine="openpyxl") as writer:
                    for sheet_name, df_sheet in sheets.items():
                        df_sheet.to_excel(writer, sheet_name=sheet_name, index=False)

                self.send_json_response(200, {
                    "status": "success",
                    "message": "Bulk approval status updated."
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_response(500, f"Error in bulk approval: {str(e)}")
            return

        elif path == "/api/approve/reset":
            try:
                if not os.path.exists(EXCEL_PATH):
                    self.send_error_response(404, f"Excel file {EXCEL_PATH} not found.")
                    return

                # Read all sheets
                excel_file = pd.ExcelFile(EXCEL_PATH)
                sheets = {}
                for sheet in excel_file.sheet_names:
                    sheets[sheet] = pd.read_excel(excel_file, sheet_name=sheet)

                df_projects = sheets["Projects"]
                df_projects["Approved By"] = None

                # Write all sheets back
                with pd.ExcelWriter(EXCEL_PATH, engine="openpyxl") as writer:
                    for sheet_name, df_sheet in sheets.items():
                        df_sheet.to_excel(writer, sheet_name=sheet_name, index=False)

                self.send_json_response(200, {
                    "status": "success",
                    "message": "All project approvals reset successfully."
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_response(500, f"Error resetting approvals: {str(e)}")
            return

        self.send_error_response(404, "Endpoint not found.")

    def send_json_response(self, status_code, data):
        response_body = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def send_error_response(self, status_code, message):
        response_body = json.dumps({"status": "error", "message": message}).encode('utf-8')
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, PMORequestHandler)
    print(f"PMO Web Portal local server running at: http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
