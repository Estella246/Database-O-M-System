-- PostgreSQL full schema init (current tables only, no data).
-- Run from repo root:
--   psql "postgresql://USER:PASS@HOST:5432/yunwei_ticket" -v ON_ERROR_STOP=1 -f db/postgres/postgres_full_init.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS public;

-- Recreate all tables in dependency-safe order.
DROP TABLE IF EXISTS public.ticket_flow_log CASCADE;
DROP TABLE IF EXISTS public.ticket_node_data CASCADE;
DROP TABLE IF EXISTS public.ticket_node_instance CASCADE;
DROP TABLE IF EXISTS public.ticket CASCADE;
DROP TABLE IF EXISTS public.option_item CASCADE;
DROP TABLE IF EXISTS public.node_field_def CASCADE;
DROP TABLE IF EXISTS public.user_account CASCADE;
DROP TABLE IF EXISTS public.role_permission_policy CASCADE;
DROP TABLE IF EXISTS public.handle_mode_next_handler_whitelist CASCADE;
DROP TABLE IF EXISTS public.workflow_node CASCADE;
DROP TABLE IF EXISTS public.workflow_template CASCADE;
DROP TABLE IF EXISTS public.option_set CASCADE;

DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

CREATE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE public.workflow_template (
    id bigserial PRIMARY KEY,
    template_code varchar(64) NOT NULL UNIQUE,
    template_name varchar(128) NOT NULL,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workflow_node (
    id bigserial PRIMARY KEY,
    template_id bigint NOT NULL REFERENCES public.workflow_template(id) ON DELETE CASCADE,
    node_key varchar(64) NOT NULL,
    node_name varchar(128) NOT NULL,
    node_order integer NOT NULL,
    is_terminal boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, node_key),
    UNIQUE (template_id, node_order)
);

CREATE TABLE public.option_set (
    id bigserial PRIMARY KEY,
    set_code varchar(64) NOT NULL UNIQUE,
    set_name varchar(128) NOT NULL,
    source_type varchar(32) NOT NULL DEFAULT 'static',
    source_config jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.handle_mode_next_handler_whitelist (
    id bigserial PRIMARY KEY,
    node_key text NOT NULL,
    handle_mode text NOT NULL,
    handler_value text NOT NULL,
    sort_order integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE (node_key, handle_mode, handler_value)
);

CREATE TABLE public.role_permission_policy (
    id bigserial PRIMARY KEY,
    role_code varchar(64) NOT NULL,
    is_pl boolean NOT NULL DEFAULT false,
    node_key varchar(64) NOT NULL,
    field_key varchar(64) NOT NULL,
    permission_level varchar(16) NOT NULL,
    updated_by varchar(64) NOT NULL DEFAULT 'system',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_permission_level CHECK (
      permission_level IN ('hidden', 'readonly', 'editable')
    ),
    UNIQUE (role_code, is_pl, node_key, field_key)
);

CREATE TABLE public.user_account (
    id bigserial PRIMARY KEY,
    account varchar(64) NOT NULL UNIQUE,
    user_name varchar(128) NOT NULL,
    role_code varchar(64) NOT NULL,
    group_name varchar(128) NOT NULL,
    is_pl boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    updated_by varchar(64) NOT NULL DEFAULT 'system',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.node_field_def (
    id bigserial PRIMARY KEY,
    node_id bigint NOT NULL REFERENCES public.workflow_node(id) ON DELETE CASCADE,
    field_key varchar(64) NOT NULL,
    field_name varchar(128) NOT NULL,
    field_type varchar(32) NOT NULL,
    required boolean NOT NULL DEFAULT false,
    read_only boolean NOT NULL DEFAULT false,
    default_type varchar(32) NOT NULL DEFAULT 'none',
    default_value text,
    option_set_id bigint REFERENCES public.option_set(id),
    constraints_json jsonb,
    ui_props_json jsonb,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_node_default_type CHECK (
      default_type IN ('none', 'literal', 'today', 'login_user')
    ),
    CONSTRAINT chk_node_field_type CHECK (
      field_type IN ('text', 'richtext', 'date', 'datetime', 'whitelist')
    ),
    UNIQUE (node_id, field_key)
);

CREATE TABLE public.option_item (
    id bigserial PRIMARY KEY,
    option_set_id bigint NOT NULL REFERENCES public.option_set(id) ON DELETE CASCADE,
    option_value varchar(256) NOT NULL,
    option_label varchar(256) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (option_set_id, option_value)
);

CREATE TABLE public.ticket (
    id bigserial PRIMARY KEY,
    ticket_no varchar(32) NOT NULL UNIQUE,
    template_id bigint NOT NULL REFERENCES public.workflow_template(id),
    title varchar(256),
    current_node_id bigint REFERENCES public.workflow_node(id),
    status varchar(32) NOT NULL DEFAULT 'open',
    creator_id varchar(64) NOT NULL,
    creator_name varchar(128) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_status CHECK (
      status IN ('open', 'suspended', 'closed')
    )
);

CREATE TABLE public.ticket_node_instance (
    id bigserial PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES public.ticket(id) ON DELETE CASCADE,
    node_id bigint NOT NULL REFERENCES public.workflow_node(id),
    handler_id varchar(64),
    handler_name varchar(128),
    action_status varchar(32) NOT NULL DEFAULT 'pending',
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_node_action_status CHECK (
      action_status IN ('pending', 'processing', 'completed', 'returned', 'skipped')
    )
);

CREATE TABLE public.ticket_node_data (
    id bigserial PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES public.ticket(id) ON DELETE CASCADE,
    ticket_node_instance_id bigint NOT NULL REFERENCES public.ticket_node_instance(id) ON DELETE CASCADE,
    values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    schema_snapshot jsonb,
    created_by varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ticket_flow_log (
    id bigserial PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES public.ticket(id) ON DELETE CASCADE,
    from_node_id bigint REFERENCES public.workflow_node(id),
    to_node_id bigint REFERENCES public.workflow_node(id),
    action_type varchar(32) NOT NULL,
    operator_id varchar(64) NOT NULL,
    operator_name varchar(128) NOT NULL,
    comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ticket_flow_action_type CHECK (
      action_type IN ('submit', 'jump_submit', 'rollback', 'suspend', 'resume', 'close')
    )
);

CREATE INDEX idx_node_field_def_node_sort
ON public.node_field_def (node_id, sort_order);

CREATE INDEX idx_option_item_set_sort
ON public.option_item (option_set_id, sort_order);

CREATE INDEX idx_role_permission_lookup
ON public.role_permission_policy (role_code, is_pl, node_key);

CREATE INDEX idx_ticket_flow_log_ticket_time
ON public.ticket_flow_log (ticket_id, created_at DESC);

CREATE INDEX idx_ticket_node_data_ticket_instance
ON public.ticket_node_data (ticket_id, ticket_node_instance_id);

CREATE INDEX idx_ticket_node_instance_ticket
ON public.ticket_node_instance (ticket_id, created_at);

CREATE INDEX idx_ticket_template_status
ON public.ticket (template_id, status);

CREATE INDEX idx_user_account_role_group
ON public.user_account (role_code, group_name, is_pl);

CREATE TRIGGER trg_node_field_def_updated_at
BEFORE UPDATE ON public.node_field_def
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_option_item_updated_at
BEFORE UPDATE ON public.option_item
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_option_set_updated_at
BEFORE UPDATE ON public.option_set
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ticket_node_instance_updated_at
BEFORE UPDATE ON public.ticket_node_instance
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ticket_updated_at
BEFORE UPDATE ON public.ticket
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workflow_node_updated_at
BEFORE UPDATE ON public.workflow_node
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workflow_template_updated_at
BEFORE UPDATE ON public.workflow_template
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
