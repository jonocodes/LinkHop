import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, createMemoryHistory, RouterProvider, createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { App } from "./app-react";
import { Setup } from "./setup-react";

declare const __BUILD_TIME__: string;

declare global {
  interface Window {
    __BUILD_TIME__: string;
  }
}

function SetupWithRouter() {
  return <Setup onComplete={() => {
    window.location.href = "/";
  }} />;
}

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  path: "/",
  component: App,
  getParentRoute: () => rootRoute,
});

const setupRoute = createRoute({
  path: "/setup",
  component: SetupWithRouter,
  getParentRoute: () => rootRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, setupRoute]);

const router = createRouter({
  routeTree,
  history: createMemoryHistory(),
});

const rootElement = document.getElementById("app");

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}