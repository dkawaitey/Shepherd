import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Shepherd exposes no inbound data endpoints: everything the app reads and
// writes goes through authenticated Convex functions, and outbound work (email
// digests, device notifications) runs in scheduled functions.

export default http;
