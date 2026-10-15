import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import JwyCalculator from "./JwyCalculator.jsx";

// The developer console is a separate chunk that is only downloaded when the
// address ends in #/developer. It is not linked from anywhere in the app, and
// nothing in it works without the developer token (checked on the server).
const DeveloperConsole = lazy(() => import("./DeveloperConsole.jsx"));
const wantsConsole = () => /^#\/developer\/?$/i.test(window.location.hash);

function Root() {
  const [dev, setDev] = useState(wantsConsole());
  useEffect(() => {
    const on = () => setDev(wantsConsole());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (dev) {
    return (
      <Suspense fallback={null}>
        <DeveloperConsole />
      </Suspense>
    );
  }
  return <JwyCalculator />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
