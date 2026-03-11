import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import SessionLibrary from "./components/SessionLibrary";
import RecordingPanel from "./components/RecordingPanel";
import ProcessingView from "./components/ProcessingView";
import ReviewEditor from "./components/ReviewEditor";
import ExportView from "./components/ExportView";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<SessionLibrary />} />
          <Route path="/record" element={<RecordingPanel />} />
          <Route path="/processing" element={<ProcessingView />} />
          <Route path="/review" element={<ReviewEditor />} />
          <Route path="/export" element={<ExportView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
