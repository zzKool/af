-- The user's colour scheme in My Preferences (D43). Additive: a nullable column, null = follow the system.

CREATE TYPE "theme_preference" AS ENUM ('light', 'dark');

ALTER TABLE "user_preferences" ADD COLUMN "theme" "theme_preference";
