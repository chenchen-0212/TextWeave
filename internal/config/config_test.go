package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCacheRoundTrip(t *testing.T) {
	baseDir = t.TempDir()
	defer func() { baseDir = "" }()

	// 文件不存在时返回空串而不是报错
	raw, err := ReadCache("history.json")
	if err != nil || raw != "" {
		t.Fatalf("ReadCache missing = %q, %v", raw, err)
	}

	if err := WriteCache("history.json", `[{"id":"his-1"}]`); err != nil {
		t.Fatalf("WriteCache: %v", err)
	}
	raw, err = ReadCache("history.json")
	if err != nil || raw != `[{"id":"his-1"}]` {
		t.Fatalf("ReadCache = %q, %v", raw, err)
	}
	// 原子写不应留下临时文件
	if _, err := os.Stat(filepath.Join(baseDir, "history.json.tmp")); !os.IsNotExist(err) {
		t.Fatalf("临时文件未清理: %v", err)
	}

	// 前端传入的路径片段被压平，不会写到数据目录之外
	if err := WriteCache("../escape.json", `[]`); err != nil {
		t.Fatalf("WriteCache escape: %v", err)
	}
	if _, err := os.Stat(filepath.Join(baseDir, "escape.json")); err != nil {
		t.Fatalf("未写到数据目录内: %v", err)
	}
}
