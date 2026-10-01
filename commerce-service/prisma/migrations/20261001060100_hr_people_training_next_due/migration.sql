-- Overdue and refresher queries filter on one column: "nextDueOn" is the due date while an
-- assignment is open and the expiry date once it is completed (NULL when it never expires
-- or a later completion replaced it). Replaces the two indexes that could not serve both.
ALTER TABLE "commerce_hr_training_assignments" ADD COLUMN "nextDueOn" DATE;

UPDATE "commerce_hr_training_assignments" SET "nextDueOn" = "dueDate" WHERE "status" <> 'completed';
UPDATE "commerce_hr_training_assignments" SET "nextDueOn" = "expiresAt" WHERE "status" = 'completed' AND "supersededAt" IS NULL;

DROP INDEX "idx_hr_training_course";
DROP INDEX "idx_hr_training_status_due";
DROP INDEX "idx_hr_training_status_expiry";

CREATE INDEX "idx_hr_training_course" ON "commerce_hr_training_assignments"("courseId", "createdAt" DESC);
CREATE INDEX "idx_hr_training_status" ON "commerce_hr_training_assignments"("status", "createdAt" DESC);
CREATE INDEX "idx_hr_training_created" ON "commerce_hr_training_assignments"("createdAt" DESC);
CREATE INDEX "idx_hr_training_next_due" ON "commerce_hr_training_assignments"("nextDueOn");
