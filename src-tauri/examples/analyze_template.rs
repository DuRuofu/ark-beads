use ark_beads_lib::template;
use std::{env, fs, process};

fn main() {
    let Some(path) = env::args().nth(1) else {
        eprintln!("usage: cargo run --example analyze_template -- <template.json>");
        process::exit(2);
    };

    let json = fs::read_to_string(&path).unwrap_or_else(|error| {
        eprintln!("failed to read {path}: {error}");
        process::exit(2);
    });
    let analysis = template::analyze(&json).unwrap_or_else(|error| {
        eprintln!("invalid template: {error}");
        process::exit(1);
    });

    println!("{}", serde_json::to_string_pretty(&analysis).unwrap());
}
