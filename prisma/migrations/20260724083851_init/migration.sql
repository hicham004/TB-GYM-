-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TEXT
);

-- CreateTable
CREATE TABLE "CategoryPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "sender_role" TEXT,
    "sender_name" TEXT,
    "message" TEXT NOT NULL,
    "context" TEXT
);

-- CreateTable
CREATE TABLE "ClientInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "full_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "date_of_birth" TEXT,
    "height_cm" REAL,
    "weight_kg" REAL,
    "starting_weight_kg" REAL,
    "goal" TEXT,
    "medical_conditions" TEXT,
    "allergies" TEXT,
    "program_name" TEXT,
    "program_duration_weeks" INTEGER DEFAULT 4,
    "program_start_date" TEXT,
    "program_end_date" TEXT,
    "payment_due_date" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'not_paid',
    "welcome_message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateTable
CREATE TABLE "ClientStrengthRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "exercise_title" TEXT NOT NULL,
    "one_rm_kg" REAL NOT NULL,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT,
    "client_email" TEXT,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT,
    "duration_weeks" INTEGER NOT NULL DEFAULT 12,
    "total_fee" REAL,
    "amount_paid" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "payment_reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "renewal_reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "DayNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "program_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "coach_note" TEXT,
    "client_note" TEXT
);

-- CreateTable
CREATE TABLE "DietDayLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "diet_plan_id" TEXT,
    "date" TEXT NOT NULL,
    "meal_logs" TEXT
);

-- CreateTable
CREATE TABLE "DietPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "name" TEXT NOT NULL,
    "assigned_client_id" TEXT,
    "total_daily_calories" REAL,
    "total_daily_protein" REAL,
    "total_daily_carbs" REAL,
    "total_daily_fats" REAL,
    "meals" TEXT
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "title" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "video_url" TEXT,
    "description" TEXT,
    "thumbnail_url" TEXT
);

-- CreateTable
CREATE TABLE "ExerciseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT
);

-- CreateTable
CREATE TABLE "Meal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Lunch',
    "custom_category" TEXT,
    "calories" REAL,
    "protein" REAL,
    "carbs" REAL,
    "fats" REAL,
    "fiber" REAL,
    "sodium" REAL,
    "servings" REAL DEFAULT 1,
    "prep_time_minutes" INTEGER,
    "cook_time_minutes" INTEGER,
    "weight_mode" TEXT NOT NULL DEFAULT 'raw',
    "ingredients" TEXT,
    "preparation_steps" TEXT,
    "cooking_tips" TEXT,
    "image_url" TEXT,
    "source_url" TEXT,
    "tags" TEXT
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ProgramCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT,
    "duration_weeks" INTEGER,
    "payment_due_date" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'not_paid',
    "status" TEXT NOT NULL DEFAULT 'active',
    "assigned_program_id" TEXT,
    "notes" TEXT,
    "payment_reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "renewal_reminder_sent" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ProgramExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "program_id" TEXT NOT NULL,
    "exercise_id" TEXT,
    "exercise_title" TEXT,
    "week" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "order" INTEGER,
    "sets" INTEGER,
    "reps" TEXT,
    "rpe" REAL,
    "rir" REAL,
    "one_rm" REAL,
    "weight_lifted" REAL,
    "completed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ProgramStrengthProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "program_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "exercise_title" TEXT,
    "one_rm_kg" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "num_weeks" INTEGER NOT NULL DEFAULT 4,
    "num_days_per_week" INTEGER NOT NULL DEFAULT 5,
    "assigned_client_id" TEXT,
    "admin_notes" TEXT,
    "client_notes" TEXT,
    "visibility_mode" TEXT NOT NULL DEFAULT 'progressive',
    "unlocked_weeks" TEXT
);

-- CreateTable
CREATE TABLE "WeightLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "client_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weight_kg" REAL NOT NULL,
    "note" TEXT,
    "body_fat_pct" REAL,
    "waist_cm" REAL,
    "chest_cm" REAL,
    "hip_cm" REAL,
    "steps" INTEGER
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" DATETIME NOT NULL,
    "created_by" TEXT,
    "full_name" TEXT,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'client',
    "password_hash" TEXT,
    "phone" TEXT,
    "date_of_birth" TEXT,
    "height_cm" REAL,
    "weight_kg" REAL,
    "starting_weight_kg" REAL,
    "target_weight_kg" REAL,
    "goal" TEXT,
    "medical_conditions" TEXT,
    "allergies" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'not_paid',
    "payment_due_date" TEXT,
    "program_start_date" TEXT,
    "program_end_date" TEXT,
    "account_start_date" TEXT,
    "assigned_program_id" TEXT,
    "assigned_diet_plan_id" TEXT,
    "welcome_message" TEXT,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TEXT,
    "can_edit_weight_lifted" BOOLEAN NOT NULL DEFAULT true,
    "can_edit_rpe" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_rir" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "AccessRequest_email_idx" ON "AccessRequest"("email");

-- CreateIndex
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

-- CreateIndex
CREATE INDEX "AccessRequest_created_date_idx" ON "AccessRequest"("created_date");

-- CreateIndex
CREATE INDEX "CategoryPermission_client_id_idx" ON "CategoryPermission"("client_id");

-- CreateIndex
CREATE INDEX "CategoryPermission_category_id_idx" ON "CategoryPermission"("category_id");

-- CreateIndex
CREATE INDEX "CategoryPermission_client_id_category_id_idx" ON "CategoryPermission"("client_id", "category_id");

-- CreateIndex
CREATE INDEX "ChatMessage_client_id_idx" ON "ChatMessage"("client_id");

-- CreateIndex
CREATE INDEX "ChatMessage_created_date_idx" ON "ChatMessage"("created_date");

-- CreateIndex
CREATE INDEX "ClientInvitation_email_idx" ON "ClientInvitation"("email");

-- CreateIndex
CREATE INDEX "ClientInvitation_status_idx" ON "ClientInvitation"("status");

-- CreateIndex
CREATE INDEX "ClientInvitation_created_date_idx" ON "ClientInvitation"("created_date");

-- CreateIndex
CREATE INDEX "ClientStrengthRecord_client_id_idx" ON "ClientStrengthRecord"("client_id");

-- CreateIndex
CREATE INDEX "ClientStrengthRecord_exercise_id_idx" ON "ClientStrengthRecord"("exercise_id");

-- CreateIndex
CREATE INDEX "ClientStrengthRecord_client_id_exercise_id_idx" ON "ClientStrengthRecord"("client_id", "exercise_id");

-- CreateIndex
CREATE INDEX "ClientSubscription_client_id_idx" ON "ClientSubscription"("client_id");

-- CreateIndex
CREATE INDEX "ClientSubscription_status_idx" ON "ClientSubscription"("status");

-- CreateIndex
CREATE INDEX "ClientSubscription_end_date_idx" ON "ClientSubscription"("end_date");

-- CreateIndex
CREATE INDEX "DayNote_program_id_idx" ON "DayNote"("program_id");

-- CreateIndex
CREATE INDEX "DayNote_client_id_idx" ON "DayNote"("client_id");

-- CreateIndex
CREATE INDEX "DayNote_program_id_week_day_idx" ON "DayNote"("program_id", "week", "day");

-- CreateIndex
CREATE INDEX "DietDayLog_client_id_idx" ON "DietDayLog"("client_id");

-- CreateIndex
CREATE INDEX "DietDayLog_diet_plan_id_idx" ON "DietDayLog"("diet_plan_id");

-- CreateIndex
CREATE INDEX "DietDayLog_date_idx" ON "DietDayLog"("date");

-- CreateIndex
CREATE INDEX "DietDayLog_client_id_date_idx" ON "DietDayLog"("client_id", "date");

-- CreateIndex
CREATE INDEX "DietPlan_assigned_client_id_idx" ON "DietPlan"("assigned_client_id");

-- CreateIndex
CREATE INDEX "DietPlan_created_date_idx" ON "DietPlan"("created_date");

-- CreateIndex
CREATE INDEX "Exercise_category_id_idx" ON "Exercise"("category_id");

-- CreateIndex
CREATE INDEX "Exercise_title_idx" ON "Exercise"("title");

-- CreateIndex
CREATE INDEX "Exercise_created_date_idx" ON "Exercise"("created_date");

-- CreateIndex
CREATE INDEX "ExerciseCategory_name_idx" ON "ExerciseCategory"("name");

-- CreateIndex
CREATE INDEX "Meal_category_idx" ON "Meal"("category");

-- CreateIndex
CREATE INDEX "Meal_name_idx" ON "Meal"("name");

-- CreateIndex
CREATE INDEX "Meal_created_date_idx" ON "Meal"("created_date");

-- CreateIndex
CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

-- CreateIndex
CREATE INDEX "Notification_read_idx" ON "Notification"("read");

-- CreateIndex
CREATE INDEX "Notification_created_date_idx" ON "Notification"("created_date");

-- CreateIndex
CREATE INDEX "ProgramCycle_client_id_idx" ON "ProgramCycle"("client_id");

-- CreateIndex
CREATE INDEX "ProgramCycle_assigned_program_id_idx" ON "ProgramCycle"("assigned_program_id");

-- CreateIndex
CREATE INDEX "ProgramCycle_status_idx" ON "ProgramCycle"("status");

-- CreateIndex
CREATE INDEX "ProgramCycle_payment_status_idx" ON "ProgramCycle"("payment_status");

-- CreateIndex
CREATE INDEX "ProgramExercise_program_id_idx" ON "ProgramExercise"("program_id");

-- CreateIndex
CREATE INDEX "ProgramExercise_exercise_id_idx" ON "ProgramExercise"("exercise_id");

-- CreateIndex
CREATE INDEX "ProgramExercise_program_id_week_day_idx" ON "ProgramExercise"("program_id", "week", "day");

-- CreateIndex
CREATE INDEX "ProgramStrengthProfile_program_id_idx" ON "ProgramStrengthProfile"("program_id");

-- CreateIndex
CREATE INDEX "ProgramStrengthProfile_client_id_idx" ON "ProgramStrengthProfile"("client_id");

-- CreateIndex
CREATE INDEX "ProgramStrengthProfile_exercise_id_idx" ON "ProgramStrengthProfile"("exercise_id");

-- CreateIndex
CREATE INDEX "ProgramStrengthProfile_program_id_client_id_exercise_id_idx" ON "ProgramStrengthProfile"("program_id", "client_id", "exercise_id");

-- CreateIndex
CREATE INDEX "TrainingProgram_assigned_client_id_idx" ON "TrainingProgram"("assigned_client_id");

-- CreateIndex
CREATE INDEX "TrainingProgram_created_date_idx" ON "TrainingProgram"("created_date");

-- CreateIndex
CREATE INDEX "WeightLog_client_id_idx" ON "WeightLog"("client_id");

-- CreateIndex
CREATE INDEX "WeightLog_date_idx" ON "WeightLog"("date");

-- CreateIndex
CREATE INDEX "WeightLog_client_id_date_idx" ON "WeightLog"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_payment_status_idx" ON "User"("payment_status");

-- CreateIndex
CREATE INDEX "User_is_deleted_idx" ON "User"("is_deleted");
