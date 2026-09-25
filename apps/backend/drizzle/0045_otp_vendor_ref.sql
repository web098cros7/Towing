--
-- Login codes the VENDOR makes and checks.
--
-- MSG91's OTP Widget sends through MSG91's own approved templates (no DLT
-- registration of our own), but it generates the code itself and checks it
-- itself. The server keeps the challenge, the attempt cap and the expiry; it
-- stores MSG91's request id here and asks MSG91 whether a typed code is right.
-- Null for codes we make, which are checked against `code_hash` as before.
--
ALTER TABLE "otp_verifications" ADD COLUMN IF NOT EXISTS "vendor_ref" text;
