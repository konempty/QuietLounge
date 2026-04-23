import UIKit

class SplashViewController: UIViewController {

    private let brandColor = AppColors.primary

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = brandColor

        // Q 로고 박스
        let logoBox = UIView()
        logoBox.backgroundColor = .white
        logoBox.layer.cornerRadius = 16
        logoBox.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(logoBox)

        let logoLabel = UILabel()
        logoLabel.text = "Q"
        logoLabel.font = .systemFont(ofSize: 40, weight: .bold)
        logoLabel.textColor = brandColor
        logoLabel.textAlignment = .center
        logoLabel.translatesAutoresizingMaskIntoConstraints = false
        logoBox.addSubview(logoLabel)

        // 앱 이름
        let nameLabel = UILabel()
        nameLabel.text = "QuietLounge"
        nameLabel.font = .systemFont(ofSize: 24, weight: .bold)
        nameLabel.textColor = .white
        nameLabel.textAlignment = .center
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(nameLabel)

        NSLayoutConstraint.activate([
            logoBox.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            logoBox.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),
            logoBox.widthAnchor.constraint(equalToConstant: 80),
            logoBox.heightAnchor.constraint(equalToConstant: 80),

            logoLabel.centerXAnchor.constraint(equalTo: logoBox.centerXAnchor),
            logoLabel.centerYAnchor.constraint(equalTo: logoBox.centerYAnchor),

            nameLabel.topAnchor.constraint(equalTo: logoBox.bottomAnchor, constant: 16),
            nameLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
    }
}
