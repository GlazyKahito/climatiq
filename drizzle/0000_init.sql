CREATE TYPE "public"."advisory_status" AS ENUM('draft', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('active', 'acknowledged', 'resolved', 'expired');--> statement-breakpoint
CREATE TYPE "public"."audience" AS ENUM('government', 'disaster_mgmt', 'field_team', 'public');--> statement-breakpoint
CREATE TYPE "public"."climate_zone" AS ENUM('plains', 'coastal', 'hilly');--> statement-breakpoint
CREATE TYPE "public"."confidence_label" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."data_kind" AS ENUM('observed', 'reanalysis', 'nwp_forecast', 'model_forecast', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('reported', 'triaged', 'in_progress', 'monitoring', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."obs_quality" AS ENUM('verified', 'unverified', 'suspect', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('p1', 'p2', 'p3', 'p4');--> statement-breakpoint
CREATE TYPE "public"."region_level" AS ENUM('country', 'state', 'district', 'city');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scenario" AS ENUM('live', 'replay');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'moderate', 'high', 'extreme');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('official', 'external_api', 'iot', 'model', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('online', 'degraded', 'offline', 'planned');--> statement-breakpoint
CREATE TYPE "public"."station_type" AS ENUM('aws_simulated', 'iot', 'external');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."team_kind" AS ENUM('state_eoc', 'district_response', 'field_unit', 'health', 'analysis');--> statement-breakpoint
CREATE TABLE "advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"severity" "severity" NOT NULL,
	"audience" "audience" NOT NULL,
	"status" "advisory_status" DEFAULT 'draft' NOT NULL,
	"forecast_run_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"expected_duration_days" integer DEFAULT 0 NOT NULL,
	"confidence" "confidence_label" NOT NULL,
	"content" jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"fallback_reason" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "advisories_valid_ck" CHECK ("advisories"."valid_from" <= "advisories"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "advisory_regions" (
	"advisory_id" uuid NOT NULL,
	"region_id" integer NOT NULL,
	CONSTRAINT "advisory_regions_advisory_id_region_id_pk" PRIMARY KEY("advisory_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" integer NOT NULL,
	"forecast_id" bigint,
	"advisory_id" uuid,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"target_date" date NOT NULL,
	"status" "alert_status" DEFAULT 'active' NOT NULL,
	"dedup_key" text NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_score" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"region_id" integer,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "climate_normals" (
	"region_id" integer NOT NULL,
	"day_of_year" integer NOT NULL,
	"normal_tmax_c" double precision NOT NULL,
	"normal_tmin_c" double precision,
	"basis" text NOT NULL,
	"sample_years" integer NOT NULL,
	"data_kind" "data_kind" NOT NULL,
	CONSTRAINT "climate_normals_region_id_day_of_year_pk" PRIMARY KEY("region_id","day_of_year"),
	CONSTRAINT "normals_doy_ck" CHECK ("climate_normals"."day_of_year" between 1 and 366)
);
--> statement-breakpoint
CREATE TABLE "daily_climate" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"day" date NOT NULL,
	"data_kind" "data_kind" NOT NULL,
	"tmax_c" double precision,
	"tmin_c" double precision,
	"apparent_tmax_c" double precision,
	"rh_mean_pct" double precision,
	"wind_max_kmh" double precision,
	"radiation_mj" double precision,
	"ingestion_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_climate_kind_ck" CHECK ("daily_climate"."data_kind" <> 'model_forecast')
);
--> statement-breakpoint
CREATE TABLE "data_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text NOT NULL,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text,
	"license" text,
	"attribution" text,
	"is_configured" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "data_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "forecast_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_version_id" integer NOT NULL,
	"scenario" "scenario" DEFAULT 'live' NOT NULL,
	"issued_for" date NOT NULL,
	"horizon_days" integer NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"is_hindcast" boolean DEFAULT false NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"regions_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"triggered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "forecast_runs_horizon_ck" CHECK ("forecast_runs"."horizon_days" between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "forecast_verifications" (
	"forecast_id" bigint PRIMARY KEY NOT NULL,
	"observed_tmax_c" double precision NOT NULL,
	"observed_kind" "data_kind" NOT NULL,
	"error_c" double precision NOT NULL,
	"observed_severity" "severity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecasts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"region_id" integer NOT NULL,
	"target_date" date NOT NULL,
	"horizon_day" integer NOT NULL,
	"resolution" text NOT NULL,
	"predicted_tmax_c" double precision NOT NULL,
	"lower_c" double precision NOT NULL,
	"upper_c" double precision NOT NULL,
	"predicted_tmin_c" double precision,
	"nwp_tmax_c" double precision,
	"normal_tmax_c" double precision,
	"departure_c" double precision,
	"severity" "severity" NOT NULL,
	"imd_category" text NOT NULL,
	"confidence" "confidence_label" NOT NULL,
	"confidence_score" double precision NOT NULL,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "forecasts_interval_ck" CHECK ("forecasts"."lower_c" <= "forecasts"."predicted_tmax_c" and "forecasts"."predicted_tmax_c" <= "forecasts"."upper_c"),
	CONSTRAINT "forecasts_conf_ck" CHECK ("forecasts"."confidence_score" between 0 and 1),
	CONSTRAINT "forecasts_imd_ck" CHECK ("forecasts"."imd_category" in ('none','heatwave','severe_heatwave'))
);
--> statement-breakpoint
CREATE TABLE "incident_activities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "priority" DEFAULT 'p3' NOT NULL,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"region_id" integer NOT NULL,
	"severity" "severity" NOT NULL,
	"priority" "priority" NOT NULL,
	"status" "incident_status" DEFAULT 'reported' NOT NULL,
	"alert_id" uuid,
	"advisory_id" uuid,
	"team_id" integer,
	"owner_id" uuid,
	"due_at" timestamp with time zone,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution_summary" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "incidents_ref_unique" UNIQUE("ref"),
	CONSTRAINT "incidents_closed_ck" CHECK (("incidents"."status" not in ('resolved','closed')) or "incidents"."resolution_summary" is not null)
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" integer NOT NULL,
	"job" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"triggered_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_in" integer DEFAULT 0 NOT NULL,
	"records_written" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"description" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"kind" text NOT NULL,
	"severity" "severity",
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"region_id" integer,
	"alert_id" uuid,
	"advisory_id" uuid,
	"incident_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_warnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"color_code" text NOT NULL,
	"title" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "official_color_ck" CHECK ("official_warnings"."color_code" in ('green','yellow','orange','red'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" "region_level" NOT NULL,
	"parent_id" integer,
	"path" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"climate_zone" "climate_zone" DEFAULT 'plains' NOT NULL,
	"is_pilot" boolean DEFAULT false NOT NULL,
	"population" integer,
	"geo_source" text NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code"),
	CONSTRAINT "regions_lat_ck" CHECK ("regions"."lat" between -90 and 90),
	CONSTRAINT "regions_lon_ck" CHECK ("regions"."lon" between -180 and 180),
	CONSTRAINT "regions_parent_ck" CHECK (("regions"."level" = 'country') = ("regions"."parent_id" is null))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "seed_state" (
	"step" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "severity_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"zone" "climate_zone" NOT NULL,
	"level" "severity" NOT NULL,
	"min_tmax_c" double precision,
	"min_departure_c" double precision,
	"absolute_tmax_c" double precision,
	"basis" text NOT NULL,
	"is_official_criterion" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"temp_c" double precision,
	"humidity_pct" double precision,
	"wind_kmh" double precision,
	"pressure_hpa" double precision,
	"data_kind" "data_kind" NOT NULL,
	"quality" "obs_quality" DEFAULT 'unverified' NOT NULL,
	"ingestion_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_obs_temp_ck" CHECK ("station_observations"."temp_c" is null or "station_observations"."temp_c" between -60 and 65),
	CONSTRAINT "station_obs_rh_ck" CHECK ("station_observations"."humidity_pct" is null or "station_observations"."humidity_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "team_kind" NOT NULL,
	"region_id" integer NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" integer NOT NULL,
	"region_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"designation" text,
	"password_hash" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"theme_pref" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_theme_ck" CHECK ("users"."theme_pref" in ('light','dark','system'))
);
--> statement-breakpoint
CREATE TABLE "weather_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"elevation_m" integer,
	"station_type" "station_type" NOT NULL,
	"source_id" integer NOT NULL,
	"status" "station_status" DEFAULT 'planned' NOT NULL,
	"is_simulated" boolean NOT NULL,
	"sensors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"api_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "weather_stations_code_unique" UNIQUE("code"),
	CONSTRAINT "stations_sim_ck" CHECK (("weather_stations"."station_type" = 'aws_simulated') = "weather_stations"."is_simulated")
);
--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_forecast_run_id_forecast_runs_id_fk" FOREIGN KEY ("forecast_run_id") REFERENCES "public"."forecast_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_regions" ADD CONSTRAINT "advisory_regions_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_regions" ADD CONSTRAINT "advisory_regions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_forecast_id_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."forecasts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "climate_normals" ADD CONSTRAINT "climate_normals_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_climate" ADD CONSTRAINT "daily_climate_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_climate" ADD CONSTRAINT "daily_climate_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_climate" ADD CONSTRAINT "daily_climate_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_corrections" ADD CONSTRAINT "data_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_verifications" ADD CONSTRAINT "forecast_verifications_forecast_id_forecasts_id_fk" FOREIGN KEY ("forecast_id") REFERENCES "public"."forecasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_run_id_forecast_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."forecast_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_activities" ADD CONSTRAINT "incident_activities_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_activities" ADD CONSTRAINT "incident_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_tasks" ADD CONSTRAINT "incident_tasks_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_tasks" ADD CONSTRAINT "incident_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_tasks" ADD CONSTRAINT "incident_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_warnings" ADD CONSTRAINT "official_warnings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_warnings" ADD CONSTRAINT "official_warnings_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_id_regions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_observations" ADD CONSTRAINT "station_observations_station_id_weather_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."weather_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_observations" ADD CONSTRAINT "station_observations_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_stations" ADD CONSTRAINT "weather_stations_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_stations" ADD CONSTRAINT "weather_stations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisories_status_idx" ON "advisories" USING btree ("status","generated_at");--> statement-breakpoint
CREATE INDEX "advisory_regions_region_idx" ON "advisory_regions" USING btree ("region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedup_open_uq" ON "alerts" USING btree ("dedup_key") WHERE "alerts"."status" in ('active','acknowledged');--> statement-breakpoint
CREATE INDEX "alerts_region_idx" ON "alerts" USING btree ("region_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_climate_uq" ON "daily_climate" USING btree ("region_id","source_id","day","data_kind");--> statement-breakpoint
CREATE INDEX "daily_climate_region_day_idx" ON "daily_climate" USING btree ("region_id","day");--> statement-breakpoint
CREATE INDEX "forecast_runs_issued_idx" ON "forecast_runs" USING btree ("scenario","issued_for");--> statement-breakpoint
CREATE UNIQUE INDEX "forecasts_uq" ON "forecasts" USING btree ("run_id","region_id","target_date");--> statement-breakpoint
CREATE INDEX "forecasts_region_date_idx" ON "forecasts" USING btree ("region_id","target_date");--> statement-breakpoint
CREATE INDEX "forecasts_severity_idx" ON "forecasts" USING btree ("run_id","severity");--> statement-breakpoint
CREATE INDEX "incident_activities_incident_idx" ON "incident_activities" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_tasks_incident_idx" ON "incident_tasks" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_tasks_assignee_idx" ON "incident_tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "incidents_region_idx" ON "incidents" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_alert_user_uq" ON "notifications" USING btree ("user_id","alert_id") WHERE "notifications"."alert_id" is not null;--> statement-breakpoint
CREATE INDEX "regions_parent_idx" ON "regions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "regions_level_idx" ON "regions" USING btree ("level");--> statement-breakpoint
CREATE INDEX "regions_path_idx" ON "regions" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "severity_thresholds_uq" ON "severity_thresholds" USING btree ("zone","level");--> statement-breakpoint
CREATE UNIQUE INDEX "station_obs_uq" ON "station_observations" USING btree ("station_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_uq" ON "user_roles" USING btree ("user_id","role_id",coalesce("region_id", 0));--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "stations_region_idx" ON "weather_stations" USING btree ("region_id");