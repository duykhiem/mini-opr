import { CoordinatorPage } from "./CoordinatorPage.tsx";
import { DevicePage } from "./DevicePage.tsx";
import { EocPage } from "./EocPage.tsx";
import { StartPage } from "./StartPage.tsx";

export function App() {
  switch (window.location.pathname) {
    case "/eoc":
      return <EocPage />;
    case "/device":
      return <DevicePage resourceId={new URLSearchParams(window.location.search).get("resource")} />;
    case "/coordinator":
      return <CoordinatorPage />;
    default:
      return <StartPage />;
  }
}
