package queue

import (
	"crypto/tls"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/hibiken/asynq"
)

func ParseRedisURL(redisURL string) (asynq.RedisClientOpt, error) {
	parsed, err := url.Parse(redisURL)
	if err != nil {
		return asynq.RedisClientOpt{}, err
	}

	if parsed.Host == "" {
		return asynq.RedisClientOpt{}, fmt.Errorf("invalid REDIS_URL")
	}

	db := 0
	if parsed.Path != "" {
		dbRaw := strings.TrimPrefix(parsed.Path, "/")
		if dbRaw != "" {
			if value, err := strconv.Atoi(dbRaw); err == nil {
				db = value
			}
		}
	}

	password := ""
	if parsed.User != nil {
		if p, ok := parsed.User.Password(); ok {
			password = p
		}
	}

	opt := asynq.RedisClientOpt{
		Addr:     parsed.Host,
		Password: password,
		DB:       db,
	}

	if parsed.Scheme == "rediss" {
		opt.TLSConfig = &tls.Config{}
	}

	return opt, nil
}
