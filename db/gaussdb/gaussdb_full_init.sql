--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

--
-- Name: handle_mode_next_handler_whitelist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handle_mode_next_handler_whitelist (
    id bigint NOT NULL,
    node_key text NOT NULL,
    handle_mode text NOT NULL,
    handler_value text NOT NULL,
    sort_order integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: handle_mode_next_handler_whitelist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.handle_mode_next_handler_whitelist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: handle_mode_next_handler_whitelist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.handle_mode_next_handler_whitelist_id_seq OWNED BY public.handle_mode_next_handler_whitelist.id;


--
-- Name: node_field_def; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_field_def (
    id bigint NOT NULL,
    node_id bigint NOT NULL,
    field_key character varying(64) NOT NULL,
    field_name character varying(128) NOT NULL,
    field_type character varying(32) NOT NULL,
    required boolean DEFAULT false NOT NULL,
    read_only boolean DEFAULT false NOT NULL,
    default_type character varying(32) DEFAULT 'none'::character varying NOT NULL,
    default_value text,
    option_set_id bigint,
    constraints_json jsonb,
    ui_props_json jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_node_default_type CHECK (((default_type)::text = ANY ((ARRAY['none'::character varying, 'literal'::character varying, 'today'::character varying, 'login_user'::character varying])::text[]))),
    CONSTRAINT chk_node_field_type CHECK (((field_type)::text = ANY ((ARRAY['text'::character varying, 'richtext'::character varying, 'date'::character varying, 'datetime'::character varying, 'whitelist'::character varying])::text[])))
);


--
-- Name: node_field_def_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.node_field_def_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: node_field_def_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.node_field_def_id_seq OWNED BY public.node_field_def.id;


--
-- Name: option_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.option_item (
    id bigint NOT NULL,
    option_set_id bigint NOT NULL,
    option_value character varying(256) NOT NULL,
    option_label character varying(256) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: option_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.option_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: option_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.option_item_id_seq OWNED BY public.option_item.id;


--
-- Name: option_set; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.option_set (
    id bigint NOT NULL,
    set_code character varying(64) NOT NULL,
    set_name character varying(128) NOT NULL,
    source_type character varying(32) DEFAULT 'static'::character varying NOT NULL,
    source_config jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: option_set_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.option_set_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: option_set_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.option_set_id_seq OWNED BY public.option_set.id;


--
-- Name: role_permission_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission_policy (
    id bigint NOT NULL,
    role_code character varying(64) NOT NULL,
    is_pl boolean DEFAULT false NOT NULL,
    node_key character varying(64) NOT NULL,
    field_key character varying(64) NOT NULL,
    permission_level character varying(16) NOT NULL,
    updated_by character varying(64) DEFAULT 'system'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_permission_level CHECK (((permission_level)::text = ANY ((ARRAY['hidden'::character varying, 'readonly'::character varying, 'editable'::character varying])::text[])))
);


--
-- Name: role_permission_policy_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permission_policy_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permission_policy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permission_policy_id_seq OWNED BY public.role_permission_policy.id;


--
-- Name: ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket (
    id bigint NOT NULL,
    ticket_no character varying(32) NOT NULL,
    template_id bigint NOT NULL,
    title character varying(256),
    current_node_id bigint,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    creator_id character varying(64) NOT NULL,
    creator_name character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ticket_status CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'suspended'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: ticket_flow_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_flow_log (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    from_node_id bigint,
    to_node_id bigint,
    action_type character varying(32) NOT NULL,
    operator_id character varying(64) NOT NULL,
    operator_name character varying(128) NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ticket_flow_action_type CHECK (((action_type)::text = ANY ((ARRAY['submit'::character varying, 'jump_submit'::character varying, 'rollback'::character varying, 'suspend'::character varying, 'resume'::character varying, 'close'::character varying])::text[])))
);


--
-- Name: ticket_flow_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_flow_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_flow_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_flow_log_id_seq OWNED BY public.ticket_flow_log.id;


--
-- Name: ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_id_seq OWNED BY public.ticket.id;


--
-- Name: ticket_node_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_node_data (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    ticket_node_instance_id bigint NOT NULL,
    values_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_snapshot jsonb,
    created_by character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_node_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_node_data_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_node_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_node_data_id_seq OWNED BY public.ticket_node_data.id;


--
-- Name: ticket_node_instance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_node_instance (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    node_id bigint NOT NULL,
    handler_id character varying(64),
    handler_name character varying(128),
    action_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ticket_node_action_status CHECK (((action_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'returned'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: ticket_node_instance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_node_instance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_node_instance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_node_instance_id_seq OWNED BY public.ticket_node_instance.id;


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    id bigint NOT NULL,
    account character varying(64) NOT NULL,
    user_name character varying(128) NOT NULL,
    role_code character varying(64) NOT NULL,
    group_name character varying(128) NOT NULL,
    is_pl boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by character varying(64) DEFAULT 'system'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_account_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_account_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_account_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_account_id_seq OWNED BY public.user_account.id;


--
-- Name: workflow_node; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_node (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    node_key character varying(64) NOT NULL,
    node_name character varying(128) NOT NULL,
    node_order integer NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_node_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_node_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_node_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_node_id_seq OWNED BY public.workflow_node.id;


--
-- Name: workflow_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_template (
    id bigint NOT NULL,
    template_code character varying(64) NOT NULL,
    template_name character varying(128) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_template_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_template_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_template_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_template_id_seq OWNED BY public.workflow_template.id;


--
-- Name: handle_mode_next_handler_whitelist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handle_mode_next_handler_whitelist ALTER COLUMN id SET DEFAULT nextval('public.handle_mode_next_handler_whitelist_id_seq'::regclass);


--
-- Name: node_field_def id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_field_def ALTER COLUMN id SET DEFAULT nextval('public.node_field_def_id_seq'::regclass);


--
-- Name: option_item id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_item ALTER COLUMN id SET DEFAULT nextval('public.option_item_id_seq'::regclass);


--
-- Name: option_set id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_set ALTER COLUMN id SET DEFAULT nextval('public.option_set_id_seq'::regclass);


--
-- Name: role_permission_policy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_policy ALTER COLUMN id SET DEFAULT nextval('public.role_permission_policy_id_seq'::regclass);


--
-- Name: ticket id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket ALTER COLUMN id SET DEFAULT nextval('public.ticket_id_seq'::regclass);


--
-- Name: ticket_flow_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_flow_log ALTER COLUMN id SET DEFAULT nextval('public.ticket_flow_log_id_seq'::regclass);


--
-- Name: ticket_node_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_data ALTER COLUMN id SET DEFAULT nextval('public.ticket_node_data_id_seq'::regclass);


--
-- Name: ticket_node_instance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_instance ALTER COLUMN id SET DEFAULT nextval('public.ticket_node_instance_id_seq'::regclass);


--
-- Name: user_account id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account ALTER COLUMN id SET DEFAULT nextval('public.user_account_id_seq'::regclass);


--
-- Name: workflow_node id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node ALTER COLUMN id SET DEFAULT nextval('public.workflow_node_id_seq'::regclass);


--
-- Name: workflow_template id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template ALTER COLUMN id SET DEFAULT nextval('public.workflow_template_id_seq'::regclass);


--
-- Name: handle_mode_next_handler_whitelist handle_mode_next_handler_whit_node_key_handle_mode_handler__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handle_mode_next_handler_whitelist
    ADD CONSTRAINT handle_mode_next_handler_whit_node_key_handle_mode_handler__key UNIQUE (node_key, handle_mode, handler_value);


--
-- Name: handle_mode_next_handler_whitelist handle_mode_next_handler_whitelist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handle_mode_next_handler_whitelist
    ADD CONSTRAINT handle_mode_next_handler_whitelist_pkey PRIMARY KEY (id);


--
-- Name: node_field_def node_field_def_node_id_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_field_def
    ADD CONSTRAINT node_field_def_node_id_field_key_key UNIQUE (node_id, field_key);


--
-- Name: node_field_def node_field_def_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_field_def
    ADD CONSTRAINT node_field_def_pkey PRIMARY KEY (id);


--
-- Name: option_item option_item_option_set_id_option_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_item
    ADD CONSTRAINT option_item_option_set_id_option_value_key UNIQUE (option_set_id, option_value);


--
-- Name: option_item option_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_item
    ADD CONSTRAINT option_item_pkey PRIMARY KEY (id);


--
-- Name: option_set option_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_set
    ADD CONSTRAINT option_set_pkey PRIMARY KEY (id);


--
-- Name: option_set option_set_set_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_set
    ADD CONSTRAINT option_set_set_code_key UNIQUE (set_code);


--
-- Name: role_permission_policy role_permission_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_policy
    ADD CONSTRAINT role_permission_policy_pkey PRIMARY KEY (id);


--
-- Name: role_permission_policy role_permission_policy_role_code_is_pl_node_key_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_policy
    ADD CONSTRAINT role_permission_policy_role_code_is_pl_node_key_field_key_key UNIQUE (role_code, is_pl, node_key, field_key);


--
-- Name: ticket_flow_log ticket_flow_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_flow_log
    ADD CONSTRAINT ticket_flow_log_pkey PRIMARY KEY (id);


--
-- Name: ticket_node_data ticket_node_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_data
    ADD CONSTRAINT ticket_node_data_pkey PRIMARY KEY (id);


--
-- Name: ticket_node_instance ticket_node_instance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_instance
    ADD CONSTRAINT ticket_node_instance_pkey PRIMARY KEY (id);


--
-- Name: ticket ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket
    ADD CONSTRAINT ticket_pkey PRIMARY KEY (id);


--
-- Name: ticket ticket_ticket_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket
    ADD CONSTRAINT ticket_ticket_no_key UNIQUE (ticket_no);


--
-- Name: user_account user_account_account_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_account_key UNIQUE (account);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (id);


--
-- Name: workflow_node workflow_node_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node
    ADD CONSTRAINT workflow_node_pkey PRIMARY KEY (id);


--
-- Name: workflow_node workflow_node_template_id_node_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node
    ADD CONSTRAINT workflow_node_template_id_node_key_key UNIQUE (template_id, node_key);


--
-- Name: workflow_node workflow_node_template_id_node_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node
    ADD CONSTRAINT workflow_node_template_id_node_order_key UNIQUE (template_id, node_order);


--
-- Name: workflow_template workflow_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template
    ADD CONSTRAINT workflow_template_pkey PRIMARY KEY (id);


--
-- Name: workflow_template workflow_template_template_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_template
    ADD CONSTRAINT workflow_template_template_code_key UNIQUE (template_code);


--
-- Name: idx_node_field_def_node_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_field_def_node_sort ON public.node_field_def USING btree (node_id, sort_order);


--
-- Name: idx_option_item_set_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_option_item_set_sort ON public.option_item USING btree (option_set_id, sort_order);


--
-- Name: idx_role_permission_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permission_lookup ON public.role_permission_policy USING btree (role_code, is_pl, node_key);


--
-- Name: idx_ticket_flow_log_ticket_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_flow_log_ticket_time ON public.ticket_flow_log USING btree (ticket_id, created_at DESC);


--
-- Name: idx_ticket_node_data_ticket_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_node_data_ticket_instance ON public.ticket_node_data USING btree (ticket_id, ticket_node_instance_id);


--
-- Name: idx_ticket_node_instance_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_node_instance_ticket ON public.ticket_node_instance USING btree (ticket_id, created_at);


--
-- Name: idx_ticket_template_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_template_status ON public.ticket USING btree (template_id, status);


--
-- Name: idx_user_account_role_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_account_role_group ON public.user_account USING btree (role_code, group_name, is_pl);


--
-- Name: node_field_def trg_node_field_def_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_field_def_updated_at BEFORE UPDATE ON public.node_field_def FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: option_item trg_option_item_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_option_item_updated_at BEFORE UPDATE ON public.option_item FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: option_set trg_option_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_option_set_updated_at BEFORE UPDATE ON public.option_set FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: ticket_node_instance trg_ticket_node_instance_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ticket_node_instance_updated_at BEFORE UPDATE ON public.ticket_node_instance FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: ticket trg_ticket_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ticket_updated_at BEFORE UPDATE ON public.ticket FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: workflow_node trg_workflow_node_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workflow_node_updated_at BEFORE UPDATE ON public.workflow_node FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: workflow_template trg_workflow_template_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workflow_template_updated_at BEFORE UPDATE ON public.workflow_template FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


--
-- Name: node_field_def node_field_def_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_field_def
    ADD CONSTRAINT node_field_def_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workflow_node(id) ON DELETE CASCADE;


--
-- Name: node_field_def node_field_def_option_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_field_def
    ADD CONSTRAINT node_field_def_option_set_id_fkey FOREIGN KEY (option_set_id) REFERENCES public.option_set(id);


--
-- Name: option_item option_item_option_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_item
    ADD CONSTRAINT option_item_option_set_id_fkey FOREIGN KEY (option_set_id) REFERENCES public.option_set(id) ON DELETE CASCADE;


--
-- Name: ticket ticket_current_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket
    ADD CONSTRAINT ticket_current_node_id_fkey FOREIGN KEY (current_node_id) REFERENCES public.workflow_node(id);


--
-- Name: ticket_flow_log ticket_flow_log_from_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_flow_log
    ADD CONSTRAINT ticket_flow_log_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES public.workflow_node(id);


--
-- Name: ticket_flow_log ticket_flow_log_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_flow_log
    ADD CONSTRAINT ticket_flow_log_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.ticket(id) ON DELETE CASCADE;


--
-- Name: ticket_flow_log ticket_flow_log_to_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_flow_log
    ADD CONSTRAINT ticket_flow_log_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES public.workflow_node(id);


--
-- Name: ticket_node_data ticket_node_data_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_data
    ADD CONSTRAINT ticket_node_data_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.ticket(id) ON DELETE CASCADE;


--
-- Name: ticket_node_data ticket_node_data_ticket_node_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_data
    ADD CONSTRAINT ticket_node_data_ticket_node_instance_id_fkey FOREIGN KEY (ticket_node_instance_id) REFERENCES public.ticket_node_instance(id) ON DELETE CASCADE;


--
-- Name: ticket_node_instance ticket_node_instance_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_instance
    ADD CONSTRAINT ticket_node_instance_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workflow_node(id);


--
-- Name: ticket_node_instance ticket_node_instance_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_node_instance
    ADD CONSTRAINT ticket_node_instance_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.ticket(id) ON DELETE CASCADE;


--
-- Name: ticket ticket_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket
    ADD CONSTRAINT ticket_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.workflow_template(id);


--
-- Name: workflow_node workflow_node_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node
    ADD CONSTRAINT workflow_node_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.workflow_template(id) ON DELETE CASCADE;


--
-- Requirement management tables
--

CREATE TABLE IF NOT EXISTS public.requirement (
  id BIGSERIAL PRIMARY KEY,
  requirement_no VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  proposer VARCHAR(256) NOT NULL,
  assignee VARCHAR(256) NOT NULL,
  related_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_req_no VARCHAR(64) NOT NULL DEFAULT '',
  planned_version VARCHAR(128) NOT NULL DEFAULT '',
  planned_date DATE,
  priority SMALLINT NOT NULL DEFAULT 5,
  remark TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '待分析',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requirement_status CHECK (status IN ('待分析', '待RAT决策', '开发中', '已经落地')),
  CONSTRAINT chk_requirement_priority CHECK (priority >= 1 AND priority <= 10)
);

CREATE INDEX IF NOT EXISTS idx_requirement_status ON public.requirement (status);
CREATE INDEX IF NOT EXISTS idx_requirement_assignee ON public.requirement (assignee);
CREATE INDEX IF NOT EXISTS idx_requirement_proposer ON public.requirement (proposer);
CREATE INDEX IF NOT EXISTS idx_requirement_creator ON public.requirement (creator_id);
CREATE INDEX IF NOT EXISTS idx_requirement_planned_date ON public.requirement (planned_date);

CREATE TRIGGER trg_requirement_updated_at BEFORE UPDATE ON public.requirement FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.requirement_log (
  id BIGSERIAL PRIMARY KEY,
  requirement_id BIGINT NOT NULL REFERENCES public.requirement(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  changed_fields JSONB,
  comment TEXT NOT NULL DEFAULT '',
  operator_id VARCHAR(64) NOT NULL,
  operator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirement_log_req ON public.requirement_log (requirement_id);


--
-- PostgreSQL database dump complete
--


--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: handle_mode_next_handler_whitelist; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (2, 'problem_review', '提交其他运维审核', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (4, 'ops_analysis', '提交开发分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (5, 'ops_analysis', '提交开发闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (6, 'ops_analysis', '提交运维闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (7, 'ops_analysis', '提交其他运维分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (8, 'dev_analysis', '提交开发闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (9, 'dev_analysis', '提交其他开发分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (10, 'dev_analysis', '返回运维分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (11, 'dev_closure', '提交运维闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (12, 'dev_closure', '提交其他开发闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (13, 'dev_closure', '返回开发分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (14, 'dev_closure', '返回运维分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (15, 'ops_closure', '提交运维审核关闭', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (16, 'ops_closure', '提交其他运维闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (17, 'ops_closure', '返回开发闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (18, 'ops_closure', '返回运维分析', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (20, 'audit_close', '提交其他审核关闭', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (21, 'audit_close', '返回运维闭环', 'l30030745 李潇雨', 1, true);
INSERT INTO public.handle_mode_next_handler_whitelist (id, node_key, handle_mode, handler_value, sort_order, is_active) VALUES (22, 'audit_close', '暂时挂起', 'l30030745 李潇雨', 1, true);


--
-- Data for Name: option_set; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (2, 'BIZ_ENV_SET', '业务环境', 'static', NULL, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (3, 'SEVERITY_SET', '问题严重性', 'static', NULL, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (4, 'COMPONENT_SET', '问题组件', 'static', NULL, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (5, 'OS_PROBLEM_REVIEW_HANDLE_MODE', '问题审核-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (6, 'OS_PROBLEM_REVIEW_TYPE_JUDGE', '问题审核-问题类型初步判断', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (7, 'OS_PROBLEM_REVIEW_NEXT_HANDLER', '问题审核-下一步处理人', 'external_api', '{"desc": "公司人员名单接口"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (8, 'OS_OPS_ANALYSIS_HANDLE_MODE', '运维分析-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (9, 'OS_OPS_ANALYSIS_NEXT_HANDLER', '运维分析-下一步处理人', 'external_api', '{"desc": "公司人员名单接口"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (10, 'OS_RESPONSIBILITY_INTRO', '问题引入模块', 'external_api', '{"desc": "参数配置-责任田模块（级联）"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (11, 'OS_RESPONSIBILITY_OWNER', '问题归属模块', 'external_api', '{"desc": "参数配置-责任田模块（级联）"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (12, 'OS_ISSUE_TYPE', '问题类型', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (13, 'OS_PRODUCT_LINE', '产品线', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (14, 'OS_ROOT_CAUSE_CATEGORY', '根因分类', 'external_api', '{"desc": "按问题类型动态白名单"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (15, 'OS_EVENT_LEVEL', '事件级别', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (16, 'OS_CUSTOMER_VOICE', '客户声音', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (17, 'OS_GAUSS_VERSION', '高斯版本', 'external_api', '{"desc": "参数配置-版本模块"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (18, 'OS_DEPLOY_MODE', '部署形态', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (19, 'OS_YES_NO', '是否/否是', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (20, 'OS_UPGRADE_BASELINE', '升级前基线版本', 'external_api', '{"desc": "参数配置-版本模块"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (21, 'OS_UPGRADE_STATUS', '升级状态', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (22, 'OS_DEV_ANALYSIS_HANDLE_MODE', '开发分析-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (23, 'OS_DEV_ANALYSIS_PASS_THROUGH', '开发分析-是否透传', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (24, 'OS_DEV_ANALYSIS_QUALITY', '开发分析-是否质量问题', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (25, 'OS_DEV_ANALYSIS_ROCK_VER', '开发分析-磐石版本是否涉及', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (26, 'OS_DEV_ANALYSIS_CONSULT', '开发分析-是否咨询问题', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (27, 'OS_DEV_ANALYSIS_COLLAB', '开发分析-协同处理人', 'external_api', '{"desc": "公司人员名单接口，可搜索"}', true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (28, 'OS_DEV_CLOSURE_HANDLE_MODE', '开发闭环-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (29, 'OS_WARNING_NEEDED', '是否需要预警', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (30, 'OS_IMPACT_LEVEL', '业务影响程度', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (31, 'OS_OPS_CLOSURE_HANDLE_MODE', '运维闭环-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (32, 'OS_AUDIT_CLOSE_HANDLE_MODE', '审核关闭-处理方式', 'static', NULL, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_set (id, set_code, set_name, source_type, source_config, is_active, created_at, updated_at) VALUES (1, 'LOCATION_SET', '局点', 'external_api', '{"desc": "从另一个接口拉取数值"}', true, '2026-04-09 00:45:07.921292+08', '2026-04-09 11:44:06.403696+08');


--
-- Data for Name: workflow_template; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.workflow_template (id, template_code, template_name, version, is_active, created_at, updated_at) VALUES (1, 'HCS_INCIDENT', 'HCS问题处理模板', 1, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');


--
-- Data for Name: workflow_node; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (1, 1, 'problem_fill', '问题填写', 1, false, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (2, 1, 'problem_review', '问题审核', 2, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (3, 1, 'ops_analysis', '运维分析', 3, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (4, 1, 'dev_analysis', '开发分析', 4, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (5, 1, 'dev_closure', '开发闭环', 5, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (6, 1, 'ops_closure', '运维闭环', 6, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.workflow_node (id, template_id, node_key, node_name, node_order, is_terminal, created_at, updated_at) VALUES (7, 1, 'audit_close', '审核关闭', 7, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');


--
-- Data for Name: node_field_def; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (1, 1, 'start_date', '起始日期', 'date', true, false, 'today', NULL, NULL, NULL, NULL, 1, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (2, 1, 'location', '局点', 'whitelist', true, false, 'none', NULL, 1, NULL, NULL, 2, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (3, 1, 'biz_env', '业务环境', 'whitelist', true, false, 'none', NULL, 2, NULL, NULL, 3, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (4, 1, 'severity', '问题严重性', 'whitelist', true, false, 'none', NULL, 3, NULL, NULL, 4, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (5, 1, 'component', '问题组件', 'whitelist', true, false, 'none', NULL, 4, NULL, NULL, 5, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (6, 1, 'hcs_version', 'HCS版本号', 'text', false, false, 'none', NULL, NULL, NULL, NULL, 6, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (7, 1, 'hcs_mode', 'HCS/轻量化', 'text', false, false, 'none', NULL, NULL, NULL, NULL, 7, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (8, 1, 'ecare_ticket_no', 'eCare单号', 'text', true, false, 'none', NULL, NULL, NULL, NULL, 8, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (9, 1, 'hcs_owner', 'HCS负责人', 'text', true, true, 'login_user', 'employee_id+name', NULL, NULL, NULL, 9, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (10, 1, 'issue_desc', '问题描述', 'richtext', true, false, 'none', NULL, NULL, NULL, NULL, 10, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (11, 2, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 5, NULL, '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (14, 3, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 8, '{"special": "提交其他运维分析时，仅处理方式/下一步处理人必填"}', '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (15, 3, 'next_handler', '下一步处理人', 'whitelist', true, false, 'none', NULL, 9, NULL, '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (41, 4, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 22, '{"special": "提交其他开发分析/返回运维分析时，仅处理方式和下一步处理人必填"}', '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (42, 4, 'next_handler', '下一步处理人', 'whitelist', true, false, 'none', NULL, 7, NULL, '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (16, 3, 'start_date', '起始日期', 'date', true, false, 'today', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (43, 4, 'issue_intro_module', '问题引入模块', 'whitelist', true, false, 'none', NULL, 10, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (44, 4, 'issue_owner_module', '问题归属模块', 'whitelist', true, false, 'none', NULL, 11, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (45, 4, 'front_pass_through', '是否前端透传', 'whitelist', true, false, 'none', NULL, 23, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (46, 4, 'version_pass_through', '是否透传至版本', 'whitelist', true, false, 'none', NULL, 23, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (47, 4, 'is_quality_issue', '是否质量问题', 'whitelist', true, false, 'none', NULL, 24, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (53, 4, 'workaround', '规避措施/恢复方法', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_any": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}, {"field": "is_consult_issue", "values": ["是"]}]}', '{"inherit_previous": false}', 13, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 14:24:31.813323+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (58, 5, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 28, '{"special": "提交其他开发闭环/返回开发分析/返回运维分析时，仅处理方式和下一步处理人必填"}', '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (59, 5, 'next_handler', '下一步处理人', 'whitelist', true, false, 'none', NULL, 7, NULL, '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (75, 7, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 32, '{"special": "提交其他审核关闭/返回运维闭环时，仅处理方式和下一步处理人必填"}', '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (76, 7, 'next_handler', '下一步处理人', 'whitelist', true, false, 'none', NULL, 7, '{"special": "处理方式=问题解决关闭时隐藏"}', '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (64, 6, 'handle_mode', '处理方式', 'whitelist', true, false, 'none', NULL, 31, '{"special": "提交其他运维闭环/返回开发闭环/返回运维分析时，仅处理方式和下一步处理人必填"}', '{"inherit_previous": false}', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:38:09.148623+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (65, 6, 'next_handler', '下一步处理人', 'whitelist', true, false, 'none', NULL, 7, NULL, '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:38:09.148623+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (48, 4, 'dts_no', 'DTS单号', 'text', false, false, 'none', NULL, NULL, '{"required_if": {"is_quality_issue": ["是（已知质量问题）", "是（新发现质量问题）"]}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 8, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (49, 4, 'version_pass_reason', '版本透传原因分析', 'text', false, false, 'none', NULL, NULL, '{"required_if": {"version_pass_through": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 9, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (50, 4, 'is_consult_issue', '是否咨询问题', 'whitelist', true, false, 'none', NULL, 26, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 10, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (51, 4, 'rock_version_involved', '磐石版本是否涉及', 'whitelist', false, false, 'none', NULL, 25, '{"required_if": {"is_quality_issue": ["是（已知质量问题）", "是（新发现质量问题）"]}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 11, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (52, 4, 'collaborator', '协同处理人', 'whitelist', false, false, 'none', NULL, 27, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 12, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (54, 4, 'root_cause', '问题根因', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 14, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (12, 2, 'issue_type_judge', '问题类型初步判断', 'whitelist', false, false, 'none', NULL, 6, '{"visible_when_all": [{"field": "handle_mode", "values": ["提交其他运维审核"]}], "required_when_visible": true}', '{"inherit_previous": false}', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:56:14.497846+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (13, 2, 'next_handler', '下一步处理人', 'whitelist', false, false, 'none', NULL, 7, '{"visible_when_all": [{"field": "handle_mode", "values": ["提交其他运维审核"]}, {"field": "issue_type_judge", "values": ["其他"]}], "required_when_visible": true}', '{"inherit_previous": false}', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:56:14.497846+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (82, 2, 'close_reason', '关闭原因', 'text', false, false, 'none', NULL, NULL, '{"visible_when_all": [{"field": "handle_mode", "values": ["非问题关闭"]}], "required_when_visible": true}', '{"inherit_previous": false}', 4, true, '2026-04-09 11:56:14.497846+08', '2026-04-09 11:56:14.497846+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (17, 3, 'issue_intro_module', '问题引入模块', 'whitelist', true, false, 'none', NULL, 10, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (18, 3, 'issue_owner_module', '问题归属模块', 'whitelist', true, false, 'none', NULL, 11, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (19, 3, 'severity', '问题严重性', 'whitelist', true, false, 'none', NULL, 3, '{"special": "映射前端Priority列", "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (20, 3, 'location', '局点', 'whitelist', true, false, 'none', NULL, 1, '{"source": "external_api", "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (21, 3, 'issue_type', '问题类型', 'whitelist', true, false, 'none', NULL, 12, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 8, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (22, 3, 'product_line', '产品线', 'whitelist', true, false, 'none', NULL, 13, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 9, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (23, 3, 'root_cause_category', '根因分类', 'whitelist', true, false, 'none', NULL, 14, '{"special": "按问题类型动态白名单", "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 10, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (24, 3, 'biz_env', '业务环境', 'whitelist', true, false, 'none', NULL, 2, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 11, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (25, 3, 'event_level', '事件级别', 'whitelist', true, false, 'none', NULL, 15, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 12, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (26, 3, 'component', '问题组件', 'whitelist', true, false, 'none', NULL, 4, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 13, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (27, 3, 'customer_voice', '客户声音', 'whitelist', true, false, 'none', NULL, 16, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 14, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (28, 3, 'gauss_version', '高斯版本', 'whitelist', true, false, 'none', NULL, 17, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 15, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (29, 3, 'deploy_mode', '部署形态', 'whitelist', true, false, 'none', NULL, 18, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 16, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (30, 3, 'kernel_upgrade_involved', '是否涉及内核升级', 'whitelist', true, false, 'none', NULL, 19, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 17, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (31, 3, 'kernel_upgrade_time', '内核升级时间', 'date', false, false, 'none', NULL, NULL, '{"required_if": {"kernel_upgrade_involved": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 18, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (32, 3, 'upgrade_baseline_version', '升级前基线版本', 'whitelist', false, false, 'none', NULL, 20, '{"required_if": {"kernel_upgrade_involved": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 19, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (33, 3, 'control_version', '管控版本', 'text', false, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 20, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (34, 3, 'upgrade_status', '升级状态', 'whitelist', false, false, 'none', NULL, 21, '{"required_if": {"kernel_upgrade_involved": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 21, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (35, 3, 'issue_desc', '问题描述', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": true}', 22, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (36, 3, 'error_text', '报错信息', 'text', true, false, 'none', NULL, NULL, '{"plain_text_only": true, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 23, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (37, 3, 'issue_track', '问题进展跟踪', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 24, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (38, 3, 'has_coredump_file', '是否有coredump文件', 'whitelist', false, false, 'none', NULL, 19, '{"required_if": {"issue_type": "coredump"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 25, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (39, 3, 'has_core_stack', '是否有core堆栈', 'whitelist', false, false, 'none', NULL, 19, '{"required_if": {"issue_type": "coredump"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 26, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (40, 3, 'core_stack_text', 'Core堆栈（文字版）', 'text', false, false, 'none', NULL, NULL, '{"required_if": {"issue_type": "coredump"}, "plain_text_only": true, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 27, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (83, 3, 'is_consult_issue', '是否咨询问题', 'whitelist', true, false, 'none', NULL, 26, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]}', '{"inherit_previous": false}', 28, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:07:27.674078+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (55, 4, 'issue_track', '问题进展跟踪', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 15, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (56, 4, 'dfx_gap', 'DFX能力GAP', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 16, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (57, 4, 'error_archive_text', '报错信息归档（core、报错、内存堆积上下文文字版）', 'text', false, false, 'none', NULL, NULL, '{"plain_text_only": true, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 17, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (60, 5, 'warning_needed', '是否需要预警', 'whitelist', true, false, 'none', NULL, 29, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发闭环", "返回开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (61, 5, 'impact_level', '业务影响程度', 'whitelist', false, false, 'none', NULL, 30, '{"required_if": {"warning_needed": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发闭环", "返回开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (62, 5, 'sla_analysis', 'SLA分析', 'richtext', false, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发闭环", "返回开发分析", "返回运维分析"]}]}', '{"inherit_previous": false}', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (63, 5, 'dfx_gap', 'DFX能力GAP', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他开发闭环", "返回开发分析", "返回运维分析"]}]}', '{"inherit_previous": true}', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (66, 6, 'is_quality_issue', '是否质量问题', 'whitelist', true, false, 'none', NULL, 24, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (67, 6, 'dts_no', 'DTS单号', 'text', false, false, 'none', NULL, NULL, '{"required_if": {"is_quality_issue": ["是（已知质量问题）", "是（新发现质量问题）"]}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (68, 6, 'rock_version_involved', '磐石版本是否涉及', 'whitelist', false, false, 'none', NULL, 25, '{"required_if": {"is_quality_issue": ["是（已知质量问题）", "是（新发现质量问题）"]}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (69, 6, 'collaborator', '协同处理人', 'whitelist', false, false, 'none', NULL, 27, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 8, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (70, 6, 'workaround', '规避措施/恢复方法', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 9, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (71, 6, 'root_cause', '问题根因', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 10, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (72, 6, 'issue_track', '问题进展跟踪', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 11, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (73, 6, 'dfx_gap', 'DFX能力GAP', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": true}', 12, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (74, 6, 'error_archive_text', '报错信息归档（core、报错、内存堆积上下文文字版）', 'text', false, false, 'none', NULL, NULL, '{"plain_text_only": true, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": false}', 13, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (80, 6, 'fault_recovery_involved', '是否涉及故障恢复', 'whitelist', true, false, 'none', NULL, 19, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": false}', 3, true, '2026-04-09 11:37:44.05581+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (81, 6, 'fault_to_recovery_duration', '故障到恢复用时', 'text', false, false, 'none', NULL, NULL, '{"required_if": {"fault_recovery_involved": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维闭环", "返回开发闭环", "返回运维分析"]}]}', '{"inherit_previous": false}', 4, true, '2026-04-09 11:37:44.05581+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (77, 7, 'warning_needed', '是否需要预警', 'whitelist', true, false, 'none', NULL, 29, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他审核关闭", "返回运维闭环"]}]}', '{"inherit_previous": true}', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (78, 7, 'impact_level', '业务影响程度', 'whitelist', false, false, 'none', NULL, 30, '{"required_if": {"warning_needed": "是"}, "optional_when_all": [{"field": "handle_mode", "values": ["提交其他审核关闭", "返回运维闭环"]}]}', '{"inherit_previous": true}', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');
INSERT INTO public.node_field_def (id, node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active, created_at, updated_at) VALUES (79, 7, 'dfx_gap', 'DFX能力GAP', 'richtext', true, false, 'none', NULL, NULL, '{"optional_when_all": [{"field": "handle_mode", "values": ["提交其他审核关闭", "返回运维闭环"]}]}', '{"inherit_previous": true}', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 12:16:20.928615+08');


--
-- Data for Name: option_item; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (6, 3, '致命', '致命', 3, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (7, 3, '严重', '严重', 2, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (8, 3, '一般', '一般', 1, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (9, 4, '管控问题', '管控问题', 2, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (10, 4, '内核问题', '内核问题', 1, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 00:45:07.921292+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (11, 5, '确认问题', '确认问题', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (12, 5, '提交其他运维审核', '提交其他运维审核', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (14, 5, '非问题关闭', '非问题关闭', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (15, 6, '慢SQL（SQL调优）', '慢SQL（SQL调优）', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (16, 6, '整体性能', '整体性能', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (17, 6, '升级', '升级', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (18, 6, '容灾', '容灾', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (19, 6, '备份恢复', '备份恢复', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (20, 6, 'SQL引擎-其他问题', 'SQL引擎-其他问题', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (21, 6, '存储引擎-其他问题', '存储引擎-其他问题', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (22, 6, '扩容', '扩容', 8, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (23, 6, '管控问题', '管控问题', 9, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (24, 8, '提交开发分析', '提交开发分析', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (25, 8, '提交开发闭环', '提交开发闭环', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (27, 8, '提交其他运维分析', '提交其他运维分析', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (28, 12, '慢', '慢', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (29, 12, '满', '满', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (30, 12, '错', '错', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (31, 12, 'hang', 'hang', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (32, 12, 'coredump', 'coredump', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (33, 12, '集群状态异常', '集群状态异常', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (34, 12, '数据不一致', '数据不一致', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (35, 12, '咨询问题', '咨询问题', 8, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (36, 13, '公有云', '公有云', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (37, 13, '混合云', '混合云', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (38, 13, '轻量化', '轻量化', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (39, 15, '一般问题', '一般问题', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (40, 15, '内部通报重大问题', '内部通报重大问题', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (41, 15, '管理升级预警', '管理升级预警', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (42, 15, '已管理升级', '已管理升级', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (43, 15, '事故', '事故', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (44, 15, 'P4事件', 'P4事件', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (45, 15, 'P1-P3事件', 'P1-P3事件', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (46, 16, '客户/一线不感知', '客户/一线不感知', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (47, 16, '客户/一线感知声音可控', '客户/一线感知声音可控', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (48, 16, '客户/一线感知存在风险', '客户/一线感知存在风险', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (49, 16, '重大投诉风险', '重大投诉风险', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (50, 18, '集中式', '集中式', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (51, 18, '分布式', '分布式', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (52, 18, '小型化', '小型化', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (53, 19, '是', '是', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (54, 19, '否', '否', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (55, 21, '升级观察期', '升级观察期', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (56, 21, '升级已提交', '升级已提交', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (57, 22, '提交开发闭环', '提交开发闭环', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (58, 22, '提交其他开发分析', '提交其他开发分析', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (59, 22, '返回运维分析', '返回运维分析', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (60, 23, '否', '否', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (61, 23, '是', '是', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (62, 24, '是（已知质量问题）', '是（已知质量问题）', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (63, 24, '是（新发现质量问题）', '是（新发现质量问题）', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (64, 24, '否', '否', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (65, 25, '505.2.1.SPC0800磐石版本无该问题', '505.2.1.SPC0800磐石版本无该问题', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (66, 25, '505.2.1.SPC0800磐石版本涉及-历史版本引入', '505.2.1.SPC0800磐石版本涉及-历史版本引入', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (67, 25, '505.2.1.SPC0800磐石版本引入该问题', '505.2.1.SPC0800磐石版本引入该问题', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (68, 26, '否', '否', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (69, 26, '是', '是', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (70, 28, '提交运维闭环', '提交运维闭环', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (71, 28, '提交其他开发闭环', '提交其他开发闭环', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (72, 28, '返回开发分析', '返回开发分析', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (73, 28, '返回运维分析', '返回运维分析', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (74, 29, '是', '是', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (75, 29, '否', '否', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (76, 30, '结果/数据错误', '结果/数据错误', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (77, 30, 'core/hang/报错', 'core/hang/报错', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (78, 30, '性能下降', '性能下降', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (79, 30, '内存泄露', '内存泄露', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (80, 30, '磁盘满', '磁盘满', 5, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (13, 5, '返回HCS修改', '返回HCS修改', 3, false, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:56:14.497846+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (26, 8, '提交运维闭环', '提交运维闭环', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 21:59:45.807782+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (81, 30, '升级、扩容、安装失败', '升级、扩容、安装失败', 6, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (82, 30, '其他', '其他', 7, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (83, 31, '提交运维审核关闭', '提交运维审核关闭', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (84, 31, '提交其他运维闭环', '提交其他运维闭环', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (85, 31, '返回开发闭环', '返回开发闭环', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (86, 31, '返回运维分析', '返回运维分析', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (87, 32, '问题解决关闭', '问题解决关闭', 1, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (88, 32, '提交其他审核关闭', '提交其他审核关闭', 2, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (89, 32, '返回运维闭环', '返回运维闭环', 3, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (90, 32, '暂时挂起', '暂时挂起', 4, true, '2026-04-09 11:32:19.257884+08', '2026-04-09 11:32:19.257884+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (91, 2, '生产环境（巡检）', '生产环境（巡检）', 1, true, '2026-04-09 11:44:06.403696+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (5, 2, '生产环境（运维）', '生产环境（运维）', 2, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (4, 2, '生产环境（影响业务）', '生产环境（影响业务）', 3, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (3, 2, '已投产业务测试环境', '已投产业务测试环境', 4, true, '2026-04-09 00:45:07.921292+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (95, 2, '交付阶段', '交付阶段', 5, true, '2026-04-09 11:44:06.403696+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (96, 2, 'POC阶段', 'POC阶段', 6, true, '2026-04-09 11:44:06.403696+08', '2026-04-09 11:44:06.403696+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (97, 6, '其他', '其他', 10, true, '2026-04-09 11:56:14.497846+08', '2026-04-09 11:56:14.497846+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (98, 7, 'l30030745 李潇雨', 'l30030745 李潇雨', 1, true, '2026-04-09 17:46:14.514354+08', '2026-04-09 17:46:14.514354+08');
INSERT INTO public.option_item (id, option_set_id, option_value, option_label, sort_order, is_active, created_at, updated_at) VALUES (99, 9, 'l30030745 李潇雨', 'l30030745 李潇雨', 1, true, '2026-04-09 17:46:14.514354+08', '2026-04-09 17:46:14.514354+08');


--
-- Data for Name: role_permission_policy; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (1, '普通人员', false, '__whitelist__', 'duty_roster', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (2, '普通人员', false, '__whitelist__', 'permission_table', 'hidden', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (3, '普通人员', false, '__whitelist__', 'stats_dashboard', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (5, '普通人员', false, '__whitelist__', 'ticket_detail', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (4, '普通人员', false, '__whitelist__', 'ticket_list', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (6, '普通人员', false, '__whitelist__', 'workflow_board', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (27, '管理员', false, '__whitelist__', 'admin_permissions', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (26, '管理员', false, '__whitelist__', 'admin_users', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (13, '管理员', false, '__whitelist__', 'duty_roster', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (14, '管理员', false, '__whitelist__', 'permission_table', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (15, '管理员', false, '__whitelist__', 'stats_dashboard', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (17, '管理员', false, '__whitelist__', 'ticket_detail', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (16, '管理员', false, '__whitelist__', 'ticket_list', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (18, '管理员', false, '__whitelist__', 'workflow_board', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (45, 'TAC提单', false, '__whitelist__', 'duty_roster', 'hidden', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (46, 'TAC提单', false, '__whitelist__', 'admin_users', 'hidden', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (47, 'TAC提单', false, '__whitelist__', 'admin_permissions', 'hidden', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (48, 'TAC提单', false, '__whitelist__', 'stats_dashboard', 'hidden', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (49, 'TAC提单', false, '__whitelist__', 'ticket_list', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (50, 'TAC提单', false, '__whitelist__', 'ticket_detail', 'readonly', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (51, 'TAC提单', false, '__whitelist__', 'ticket_list_scope_self', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');
INSERT INTO public.role_permission_policy (id, role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at) VALUES (52, 'TAC提单', false, '__whitelist__', 'ticket_detail_scope_problem_fill', 'editable', 'admin', '2026-04-09 17:10:47.135084+08');


--
-- Data for Name: user_account; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.user_account (id, account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at) VALUES (11, 'c30048471', '崔乐然', '普通人员', '尖刀连-SQL组', false, true, 'admin', '2026-04-09 20:13:57.658645+08');
INSERT INTO public.user_account (id, account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at) VALUES (2, 'l30030745', '李潇雨', '管理员', '特战队-流程IT', true, true, 'admin', '2026-04-09 20:13:57.658645+08');
INSERT INTO public.user_account (id, account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at) VALUES (14, 'i00822653', 'Lazov', 'TAC提单', '临时查看', false, true, 'admin', '2026-04-09 20:13:57.658645+08');


--
-- Name: handle_mode_next_handler_whitelist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.handle_mode_next_handler_whitelist_id_seq', 22, true);


--
-- Name: node_field_def_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.node_field_def_id_seq', 82, true);


--
-- Name: option_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.option_item_id_seq', 99, true);


--
-- Name: option_set_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.option_set_id_seq', 32, true);


--
-- Name: role_permission_policy_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.role_permission_policy_id_seq', 52, true);


--
-- Name: user_account_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_account_id_seq', 14, true);


--
-- Name: workflow_node_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.workflow_node_id_seq', 7, true);


--
-- Name: workflow_template_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.workflow_template_id_seq', 1, true);


--
-- PostgreSQL database dump complete
--


