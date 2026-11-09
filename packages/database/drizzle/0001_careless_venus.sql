CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'suspended');
--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');
--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');
--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('admin', 'member');
--> statement-breakpoint

CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" varchar(320),
    "display_name" varchar(160),
    "status" "user_status" DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "auth_identities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "issuer" varchar(512) NOT NULL,
    "subject" varchar(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "organization_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "role" "organization_role" DEFAULT 'member' NOT NULL,
    "status" "membership_status" DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "workspace_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid NOT NULL,
    "workspace_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "role" "workspace_role" DEFAULT 'member' NOT NULL,
    "status" "membership_status" DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Create referenced unique indexes before adding composite foreign keys.

CREATE UNIQUE INDEX "organization_memberships_org_user_unique"
ON "organization_memberships" USING btree ("organization_id", "user_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "workspaces_id_organization_id_unique"
ON "workspaces" USING btree ("id", "organization_id");
--> statement-breakpoint

-- Authentication identity constraints.

ALTER TABLE "auth_identities"
ADD CONSTRAINT "auth_identities_user_id_users_id_fk"
FOREIGN KEY ("user_id")
REFERENCES "public"."users"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Organization membership constraints.

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "organization_memberships"
ADD CONSTRAINT "organization_memberships_user_id_users_id_fk"
FOREIGN KEY ("user_id")
REFERENCES "public"."users"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Workspace membership constraints.

ALTER TABLE "workspace_memberships"
ADD CONSTRAINT "workspace_memberships_workspace_org_fk"
FOREIGN KEY ("workspace_id", "organization_id")
REFERENCES "public"."workspaces"("id", "organization_id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "workspace_memberships"
ADD CONSTRAINT "workspace_memberships_org_user_fk"
FOREIGN KEY ("organization_id", "user_id")
REFERENCES "public"."organization_memberships"("organization_id", "user_id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Remaining indexes.

CREATE UNIQUE INDEX "auth_identities_issuer_subject_unique"
ON "auth_identities" USING btree ("issuer", "subject");
--> statement-breakpoint

CREATE INDEX "auth_identities_user_id_idx"
ON "auth_identities" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "organization_memberships_user_id_idx"
ON "organization_memberships" USING btree ("user_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "workspace_memberships_workspace_user_unique"
ON "workspace_memberships" USING btree ("workspace_id", "user_id");
--> statement-breakpoint

CREATE INDEX "workspace_memberships_user_id_idx"
ON "workspace_memberships" USING btree ("user_id");
