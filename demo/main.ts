import { mount } from "svelte";
import { setOrigin } from "@sjvair/sdk/http";
import App from "./App.svelte";
import "./app.css";

// The dev server proxies /api/ to the local sjvair.com stack, so the SDK calls this origin.
setOrigin(location.origin);

mount(App, { target: document.getElementById("app")! });
