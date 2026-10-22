import { auth } from "@/auth";

export const proxy = auth((req) => {
  const { pathname, origin } = req.nextUrl;
  const loggedIn = !!req.auth;

  if (!loggedIn && pathname !== "/login") {
    return Response.redirect(new URL("/login", origin));
  }
  if (loggedIn && pathname === "/login") {
    return Response.redirect(new URL("/", origin));
  }
});

export const config = {
  // `api` is excluded on purpose: API routes return 401 themselves (step 8)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};