import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { hydrateStoresFromServer } from "@/lib/server-sync";
import "./index.css";

// Hydrate les caches locaux depuis le serveur avant le premier rendu
// (≤ 2,5 s ; en mode dégradé l'app démarre sur le dernier état local).
hydrateStoresFromServer().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
