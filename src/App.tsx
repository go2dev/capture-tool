import { Outlet } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import "./styles/app.css";

export default function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
