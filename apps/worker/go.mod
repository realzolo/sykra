module spec-axis/worker

go 1.24.0

	require (
		github.com/bmatcuk/doublestar/v4 v4.10.0
		github.com/gorilla/websocket v1.5.3
		spec-axis/scheduler v0.0.0
	)

replace spec-axis/scheduler => ../scheduler
