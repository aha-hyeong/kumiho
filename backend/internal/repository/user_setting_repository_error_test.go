package repository

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"
)

var errUserSettingsIteration = errors.New("user settings row iteration interrupted")

// A successful query whose cursor fails during iteration is not an empty result.
type userSettingsIterationDriver struct{}
type userSettingsIterationConn struct{}
type userSettingsIterationRows struct{}

func init() { sql.Register("kumiho-user-settings-iteration-error", userSettingsIterationDriver{}) }
func (userSettingsIterationDriver) Open(string) (driver.Conn, error) {
	return userSettingsIterationConn{}, nil
}
func (userSettingsIterationConn) Close() error { return nil }
func (userSettingsIterationConn) Prepare(string) (driver.Stmt, error) {
	return nil, errUserSettingsIteration
}
func (userSettingsIterationConn) Begin() (driver.Tx, error) { return nil, errUserSettingsIteration }
func (userSettingsIterationConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return userSettingsIterationRows{}, nil
}
func (userSettingsIterationRows) Columns() []string {
	return []string{"user_id", "key", "value", "updated_at"}
}
func (userSettingsIterationRows) Close() error              { return nil }
func (userSettingsIterationRows) Next([]driver.Value) error { return errUserSettingsIteration }

func TestUserSettingsGetByUserReportsIterationError(t *testing.T) {
	db, err := sql.Open("kumiho-user-settings-iteration-error", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = NewUserSettingRepository().GetByUser(db, "user")
	if !errors.Is(err, errUserSettingsIteration) {
		t.Fatalf("cursor failure = %v, want iteration error (not an empty user setting)", err)
	}
}
