use rand::Rng;

fn main() {
    let mut rng = rand::thread_rng();
    println!("{}", rng.gen::<u32>());
}