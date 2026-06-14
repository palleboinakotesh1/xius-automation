import os
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
import pandas as pd
import pmo_weekly_report

PORT = int(os.environ.get("PORT", 8000))
EXCEL_PATH = "PMO_Weekly_Report_Data.xlsx"

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
                data = {
                    "projects": pd.read_excel(excel_file, sheet_name="Projects").to_dict(orient="records"),
                    "achievements": pd.read_excel(excel_file, sheet_name="Achievements").to_dict(orient="records"),
                    "risks": pd.read_excel(excel_file, sheet_name="Risks").to_dict(orient="records"),
                    "nextsteps": pd.read_excel(excel_file, sheet_name="NextSteps").to_dict(orient="records"),
                    "decisions": pd.read_excel(excel_file, sheet_name="Decisions").to_dict(orient="records")
                }
                
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
                p_cols = ["Project", "Manager", "Planned %", "Actual %", "Budget", "Actual Cost", "Delay Days", "Risk Score"]
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

                # Write to Excel sheets
                with pd.ExcelWriter(EXCEL_PATH, engine="openpyxl") as writer:
                    df_projects.to_excel(writer, sheet_name="Projects", index=False)
                    df_achievements.to_excel(writer, sheet_name="Achievements", index=False)
                    df_risks.to_excel(writer, sheet_name="Risks", index=False)
                    df_nextsteps.to_excel(writer, sheet_name="NextSteps", index=False)
                    df_decisions.to_excel(writer, sheet_name="Decisions", index=False)

                print("Excel data updated via Web API. Running report generation...")

                # Regenerate Word report
                pmo_weekly_report.run_report_generation()

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
