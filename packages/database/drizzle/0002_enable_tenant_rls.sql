-- ============================================================
-- Atlas Enterprise: Tenant Isolation with PostgreSQL RLS
-- Custom Drizzle migration
-- ============================================================

-- ============================================================
-- 1. Transaction-local application identity
-- ============================================================

-- Missing context resolves to NULL, denying tenant access.
-- The third argument to set_config must be true so the value
-- is scoped to the current transaction.

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('app.current_user_id', true),
    ''
  )::uuid;
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_app_user_id()
TO atlas_app;


-- ============================================================
-- 2. Dedicated organization creation role
-- ============================================================

-- This role cannot log in, create databases, create roles,
-- become another role, or bypass row-level security.

CREATE ROLE atlas_org_creator
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

GRANT USAGE ON SCHEMA public
TO atlas_org_creator;

-- The function owner needs permission to read the transaction-
-- local identity and insert the organization and owner membership.

GRANT EXECUTE ON FUNCTION public.current_app_user_id()
TO atlas_org_creator;

GRANT SELECT, INSERT ON public.organizations
TO atlas_org_creator;

GRANT INSERT ON public.organization_memberships
TO atlas_org_creator;


-- ============================================================
-- 3. Enable and force RLS on tenant-owned tables
-- ============================================================

ALTER TABLE public.organizations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organization_memberships
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organization_memberships
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.workspaces
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workspaces
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_memberships
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_memberships
  FORCE ROW LEVEL SECURITY;


-- ============================================================
-- 4. Organization policies
-- ============================================================

-- Active organization members can read their organizations.

CREATE POLICY organizations_select_member
ON public.organizations
FOR SELECT
TO atlas_app
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = organizations.id
      AND membership.user_id = public.current_app_user_id()
      AND membership.status = 'active'
  )
);

-- Only the dedicated organization creation role can insert.

CREATE POLICY organizations_insert_creator
ON public.organizations
FOR INSERT
TO atlas_org_creator
WITH CHECK (true);

-- Allow the creation function to return the inserted organization.

CREATE POLICY organizations_select_creator
ON public.organizations
FOR SELECT
TO atlas_org_creator
USING (true);


-- ============================================================
-- 5. Organization membership policies
-- ============================================================

-- Users can read their own organization memberships.

CREATE POLICY organization_memberships_select_self
ON public.organization_memberships
FOR SELECT
TO atlas_app
USING (
  user_id = public.current_app_user_id()
);

-- Only the dedicated creation function can create the initial
-- owner membership, and only for the current application user.

CREATE POLICY organization_memberships_insert_creator
ON public.organization_memberships
FOR INSERT
TO atlas_org_creator
WITH CHECK (
  user_id = public.current_app_user_id()
  AND role = 'owner'
  AND status = 'active'
);


-- ============================================================
-- 6. Workspace policies
-- ============================================================

-- Active organization members can read workspaces.

CREATE POLICY workspaces_select_member
ON public.workspaces
FOR SELECT
TO atlas_app
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = workspaces.organization_id
      AND membership.user_id = public.current_app_user_id()
      AND membership.status = 'active'
  )
);

-- Only active organization owners and admins can create workspaces.

CREATE POLICY workspaces_insert_manager
ON public.workspaces
FOR INSERT
TO atlas_app
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = workspaces.organization_id
      AND membership.user_id = public.current_app_user_id()
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
  )
);


-- ============================================================
-- 7. Workspace membership policies
-- ============================================================

-- Users can read their own workspace memberships.

CREATE POLICY workspace_memberships_select_self
ON public.workspace_memberships
FOR SELECT
TO atlas_app
USING (
  user_id = public.current_app_user_id()
);


-- ============================================================
-- 8. Restrict direct application writes
-- ============================================================

-- Organization creation must go through the controlled function.

REVOKE INSERT, UPDATE, DELETE
ON public.organizations
FROM atlas_app;

-- Membership changes are not exposed directly to the application
-- until dedicated membership-management workflows are implemented.

REVOKE INSERT, UPDATE, DELETE
ON public.organization_memberships
FROM atlas_app;

REVOKE UPDATE, DELETE
ON public.workspaces
FROM atlas_app;

REVOKE INSERT, UPDATE, DELETE
ON public.workspace_memberships
FROM atlas_app;


-- ============================================================
-- 9. Atomic organization and owner creation
-- ============================================================

-- SECURITY DEFINER executes this function using the narrowly
-- privileged atlas_org_creator role.
--
-- The application cannot directly insert owner memberships.
-- Both inserts happen atomically within the calling transaction.

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  p_name varchar(160),
  p_slug varchar(80)
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_organization public.organizations;
BEGIN
  v_user_id := public.current_app_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user context is required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (
    name,
    slug
  )
  VALUES (
    p_name,
    p_slug
  )
  RETURNING * INTO v_organization;

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role,
    status
  )
  VALUES (
    v_organization.id,
    v_user_id,
    'owner',
    'active'
  );

  RETURN v_organization;
END;
$$;


-- Transfer ownership to the dedicated non-login role.

-- PostgreSQL requires the new function owner to have CREATE on the
-- containing schema at transfer time. The role does not need that
-- privilege to execute the function, so remove it immediately afterward.

GRANT CREATE ON SCHEMA public
TO atlas_org_creator;

ALTER FUNCTION public.create_organization_with_owner(
  varchar,
  varchar
)
OWNER TO atlas_org_creator;

REVOKE CREATE ON SCHEMA public
FROM atlas_org_creator;


-- Remove default PUBLIC execution permission.

REVOKE ALL ON FUNCTION public.create_organization_with_owner(
  varchar,
  varchar
)
FROM PUBLIC;


-- The runtime application role can invoke the controlled function.

GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(
  varchar,
  varchar
)
TO atlas_app;
