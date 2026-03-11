pub mod commands;
pub mod db;
pub mod models;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct SessionState {
    pub db: Mutex<Connection>,
}

impl SessionState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Mutex::new(conn),
        }
    }
}
