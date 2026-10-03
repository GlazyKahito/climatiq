CREATE TABLE "grid_daily" (
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"day" date NOT NULL,
	"data_kind" "data_kind" NOT NULL,
	"source_id" integer NOT NULL,
	"tmax_c" double precision NOT NULL,
	"ingestion_run_id" uuid,
	CONSTRAINT "grid_daily_lat_lon_day_data_kind_pk" PRIMARY KEY("lat","lon","day","data_kind")
);
--> statement-breakpoint
ALTER TABLE "climate_normals" ADD COLUMN "basis_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "climate_normals" DROP CONSTRAINT "climate_normals_region_id_day_of_year_pk";--> statement-breakpoint
ALTER TABLE "climate_normals" ADD CONSTRAINT "climate_normals_region_id_basis_key_day_of_year_pk" PRIMARY KEY("region_id","basis_key","day_of_year");--> statement-breakpoint
ALTER TABLE "grid_daily" ADD CONSTRAINT "grid_daily_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_daily" ADD CONSTRAINT "grid_daily_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grid_daily_day_idx" ON "grid_daily" USING btree ("day","data_kind");