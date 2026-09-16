"use client";

import { useEffect, useState } from "react";

export default function StatusBar() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="status-bar">
      <span>
        <span className={`status-dot ${online ? "online" : "offline"}`} />
        {online ? "Online" : "Offline"}
      </span>
      <span style={{ fontSize: 11, color: "#c8c2b3" }}>JSCI/PROD/02 · Rev 02</span>
    </div>
  );
}
