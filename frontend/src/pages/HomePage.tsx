import heroImage from '../assets/hero.png';

export default function HomePage() {
  return (
    <section className="home-page">
      <div>
        <p className="eyebrow">BiletFlow</p>
        <h1>Manage your ticket flow in one place.</h1>
        <p className="description">
          A simple workspace for organizing and tracking support tickets.
        </p>
      </div>

      <img
        src={heroImage}
        alt="BiletFlow illustration"
        className="hero-image"
      />
    </section>
  );
}