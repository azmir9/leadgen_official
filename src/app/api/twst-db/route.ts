import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import {
  createAuthDiagnosticContext,
  logAuthDiagnosticCompletion,
  logAuthDiagnosticFailure,
  runAuthDiagnosticStage,
} from "@/lib/auth-diagnostics";

export async function GET() {
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_DB_DIAGNOSTIC !== 'true') {
    return NextResponse.json({ message: 'Not found.' }, { status: 404 });
  }

  const diagnostics = createAuthDiagnosticContext('db_test_connect');
  try {
    await runAuthDiagnosticStage(diagnostics, 'db_test_connect', () => connectDB(diagnostics));
    logAuthDiagnosticCompletion(diagnostics);
    return NextResponse.json({ success: true, message: "Database connected successfully!" });
  } catch (error: unknown) {
    logAuthDiagnosticFailure(diagnostics, error);
    return NextResponse.json({ success: false, message: "Database connection failed." }, { status: 500 });
  }
}
