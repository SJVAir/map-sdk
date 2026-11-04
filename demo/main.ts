import { mount, unmount } from "svelte";
import { setOrigin } from "@sjvair/sdk/http";
import App from "./App.svelte";
import "./app.css";

// The dev server proxies /api/ to the local sjvair.com stack, so the SDK calls this origin.
setOrigin(location.origin);

const app = mount(App, { target: document.getElementById("app")! });

// Tear the page down properly (dispose the live store, release the maps) when it is unloaded;
// a page kept in the back-forward cache stays mounted so it can come back as it was.
addEventListener("pagehide", (event) => {
	if (!event.persisted) void unmount(app);
});
