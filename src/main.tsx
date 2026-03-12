import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import SessionLibrary from "./components/SessionLibrary";
import RecordingPanel from "./components/RecordingPanel";
import VoiceoverPanel from "./components/VoiceoverPanel";
import ProcessingView from "./components/ProcessingView";
import ReviewEditor from "./components/ReviewEditor";
import ExportView from "./components/ExportView";
import Settings from "./components/Settings";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<SessionLibrary />} />
          <Route path="/record" element={<RecordingPanel />} />
          <Route path="/voiceover" element={<VoiceoverPanel />} />
          <Route path="/session/:id/voiceover" element={<VoiceoverPanel />} />
          <Route path="/processing" element={<ProcessingView />} />
          <Route path="/review" element={<ReviewEditor />} />
          <Route path="/export" element={<ExportView />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
