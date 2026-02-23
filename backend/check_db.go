package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "kumiho.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	fmt.Println("=== Series Check ===")
	rows, err := db.Query("SELECT id, title, thumbnail_path, thumbnail_url FROM series WHERE title LIKE '%파이썬%'")
	if err != nil {
		log.Fatal(err)
	}
	for rows.Next() {
		var id, title string
		var path, url sql.NullString
		if scanErr := rows.Scan(&id, &title, &path, &url); scanErr != nil {
			log.Printf("failed to scan series row: %v", scanErr)
			continue
		}
		fmt.Printf("ID: %s, Title: %s, Path: %s, URL: %s\n", id, title, path.String, url.String)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		log.Printf("series rows iteration error: %v", rowsErr)
	}
	rows.Close()

	fmt.Println("\n=== Volumes Check ===")
	rows, err = db.Query("SELECT id, title, thumbnail_path, thumbnail_url FROM volumes WHERE title LIKE '%파이썬%'")
	if err != nil {
		log.Fatal(err)
	}
	for rows.Next() {
		var id, title string
		var path, url sql.NullString
		if scanErr := rows.Scan(&id, &title, &path, &url); scanErr != nil {
			log.Printf("failed to scan volume row: %v", scanErr)
			continue
		}
		fmt.Printf("ID: %s, Title: %s, Path: %s, URL: %s\n", id, title, path.String, url.String)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		log.Printf("volume rows iteration error: %v", rowsErr)
	}
	rows.Close()
}
