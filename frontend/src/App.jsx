import { useState } from "react";
import Send from "./Send.jsx";
import Receive from "./Receive.jsx";

export default function App() {
  const [tab, setTab] = useState("send");
  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" />
        <h1>wormhole<span className="tld">.dwiesta.pro</span></h1>
      </div>
      <p className="tagline">
        Send a file with a phrase. It's encrypted before it leaves your browser,
        so nobody in between — not the server, not the operator — can read it.
      </p>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "send"}
          onClick={() => setTab("send")}
        >
          send
        </button>
        <button
          role="tab"
          aria-selected={tab === "receive"}
          onClick={() => setTab("receive")}
        >
          receive
        </button>
      </div>

      {tab === "send" ? <Send /> : <Receive />}
    </div>
  );
}
