package pipeline

import "testing"

func TestUpsertManualApprovalReplacesExistingJobRecord(t *testing.T) {
	records := []manualApprovalRecord{
		{
			JobKey:         "deploy",
			ApprovedBy:     "user-1",
			ApprovedByName: "Old Approver",
			Comment:        "old",
			ApprovedAt:     "2026-04-06T10:00:00Z",
		},
	}

	next := upsertManualApproval(records, manualApprovalRecord{
		JobKey:         "deploy",
		ApprovedBy:     "user-2",
		ApprovedByName: "New Approver",
		Comment:        "approved after verification",
		ApprovedAt:     "2026-04-06T11:00:00Z",
	})

	if len(next) != 1 {
		t.Fatalf("expected 1 approval record, got %d", len(next))
	}
	if next[0].ApprovedBy != "user-2" {
		t.Fatalf("expected approval to be replaced, got %#v", next[0])
	}
	if next[0].Comment != "approved after verification" {
		t.Fatalf("expected updated comment, got %#v", next[0].Comment)
	}
}

func TestUpsertManualApprovalAppendsNewJobRecord(t *testing.T) {
	records := []manualApprovalRecord{
		{JobKey: "build", ApprovedBy: "user-1"},
	}

	next := upsertManualApproval(records, manualApprovalRecord{
		JobKey:         "deploy",
		ApprovedBy:     "user-2",
		ApprovedByName: "Approver",
	})

	if len(next) != 2 {
		t.Fatalf("expected 2 approval records, got %d", len(next))
	}
	if next[1].JobKey != "deploy" {
		t.Fatalf("expected deploy approval to be appended, got %#v", next[1])
	}
}
